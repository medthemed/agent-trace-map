import { flattenGraph, pathToSpan } from "./graph.js";
import type {
  AnalysisResult,
  Finding,
  GraphNode,
  ReasoningGraph,
  TraceEvent,
} from "./types.js";

export interface DetectorOptions {
  /** How many similar consecutive spans count as a loop. Default 3. */
  loopThreshold?: number;
  /** Minimum duration (ms) for a span to count as a stall. Default 5000. */
  stallMs?: number;
  /** Minimum gap (ms) between parent end-ish and child start for stalls. Default 3000. */
  stallGapMs?: number;
  /** Minimum count of failed tools sharing a root cause. Default 2. */
  assumptionFailureMin?: number;
}

const DEFAULTS = {
  loopThreshold: 3,
  stallMs: 5000,
  stallGapMs: 3000,
  assumptionFailureMin: 2,
};

/**
 * Stable similarity key for a span: kind + prompt_ref + normalized outcome.
 * Consecutive spans with the same key are treated as a loop candidate.
 */
export function similarityKey(event: TraceEvent): string {
  const prompt = event.prompt_ref ?? "";
  const outcome = (event.outcome ?? "").trim().toLowerCase();
  // collapse numbers so "retry 1"/"retry 2" still match
  const normalizedOutcome = outcome.replace(/\d+/g, "#");
  const tool =
    typeof event.metadata?.tool === "string" ? event.metadata.tool : "";
  return `${event.kind}|${prompt}|${tool}|${normalizedOutcome}`;
}

/**
 * Detect near-infinite loops: runs of consecutive similar spans.
 */
export function detectLoops(
  graph: ReasoningGraph,
  options: DetectorOptions = {},
): Finding[] {
  const threshold = options.loopThreshold ?? DEFAULTS.loopThreshold;
  const ordered = flattenGraph(graph);
  const findings: Finding[] = [];

  let runStart = 0;
  let runKey = ordered.length > 0 ? similarityKey(ordered[0]!.event) : "";

  const flush = (endExclusive: number): void => {
    const runLen = endExclusive - runStart;
    if (runLen < threshold) return;
    const spanIds = ordered.slice(runStart, endExclusive).map((n) => n.event.span_id);
    const kinds = [...new Set(spanIds.map((id) => graph.nodes.get(id)!.event.kind))];
    findings.push({
      detector: "loop",
      severity: runLen >= threshold * 2 ? "error" : "warning",
      title: `Repeated similar spans (${runLen}×)`,
      detail:
        `Detected ${runLen} consecutive spans with the same kind/prompt/outcome signature. ` +
        `This usually means the agent is stuck retrying without new information. ` +
        `Signature: ${runKey}`,
      span_ids: spanIds,
      data: { count: runLen, signature: runKey, kinds },
    });
  };

  for (let i = 1; i < ordered.length; i++) {
    const key = similarityKey(ordered[i]!.event);
    if (key !== runKey) {
      flush(i);
      runStart = i;
      runKey = key;
    }
  }
  flush(ordered.length);

  return findings;
}

/**
 * Detect stall regions: unusually long spans or large gaps between
 * sibling starts (using ts when available).
 */
export function detectStalls(
  graph: ReasoningGraph,
  options: DetectorOptions = {},
): Finding[] {
  const stallMs = options.stallMs ?? DEFAULTS.stallMs;
  const findings: Finding[] = [];

  for (const node of graph.nodes.values()) {
    if (node.event.duration_ms >= stallMs) {
      findings.push({
        detector: "stall",
        severity: node.event.duration_ms >= stallMs * 3 ? "error" : "warning",
        title: `Long-running ${node.event.kind} span (${node.event.duration_ms}ms)`,
        detail:
          `Span ${node.event.span_id} ran for ${node.event.duration_ms}ms ` +
          `(threshold ${stallMs}ms). Outcome: ${node.event.outcome ?? "(none)"}.`,
        span_ids: [node.event.span_id],
        data: { duration_ms: node.event.duration_ms, threshold_ms: stallMs },
      });
    }
  }

  // Gap-based stalls among siblings when ts is present
  const gapMs = options.stallGapMs ?? DEFAULTS.stallGapMs;
  for (const parent of graph.nodes.values()) {
    const kids = parent.children.filter((c) => c.event.ts);
    if (kids.length < 2) continue;
    const sorted = [...kids].sort((a, b) =>
      (a.event.ts ?? "") < (b.event.ts ?? "") ? -1 : 1,
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const prevEnd = Date.parse(prev.event.ts!) + prev.event.duration_ms;
      const nextStart = Date.parse(next.event.ts!);
      const gap = nextStart - prevEnd;
      if (Number.isFinite(gap) && gap >= gapMs) {
        findings.push({
          detector: "stall",
          severity: gap >= gapMs * 3 ? "error" : "warning",
          title: `Idle gap of ${gap}ms between sibling spans`,
          detail:
            `After ${prev.event.span_id} ended, ${next.event.span_id} did not start for ${gap}ms ` +
            `(threshold ${gapMs}ms). This often indicates blocking I/O or a hung tool.`,
          span_ids: [prev.event.span_id, next.event.span_id],
          data: { gap_ms: gap, threshold_ms: gapMs },
        });
      }
    }
  }

  return findings;
}

/**
 * Extract a root-cause-ish key from a failed span.
 */
function rootCauseKey(event: TraceEvent): string {
  const errCode =
    typeof event.metadata?.error_code === "string"
      ? event.metadata.error_code
      : typeof event.metadata?.error === "string"
        ? event.metadata.error
        : "";
  const outcome = (event.outcome ?? "").trim().toLowerCase().replace(/\d+/g, "#");
  const tool = typeof event.metadata?.tool === "string" ? event.metadata.tool : "";
  return `${errCode}|${tool}|${outcome}`;
}

/**
 * Detect assumption failures: multiple failed tool/fail spans that share
 * the same root cause, implying a shared false assumption.
 */
export function detectAssumptionFailures(
  graph: ReasoningGraph,
  options: DetectorOptions = {},
): Finding[] {
  const min = options.assumptionFailureMin ?? DEFAULTS.assumptionFailureMin;
  const groups = new Map<string, TraceEvent[]>();

  for (const node of graph.nodes.values()) {
    const e = node.event;
    if (e.kind !== "fail" && e.kind !== "tool") continue;
    const failed =
      e.kind === "fail" ||
      (typeof e.metadata?.ok === "boolean" && e.metadata.ok === false) ||
      (typeof e.outcome === "string" && /\b(fail|error|denied|timeout)\b/i.test(e.outcome));
    if (!failed) continue;
    const key = rootCauseKey(e);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const findings: Finding[] = [];
  for (const [key, events] of groups) {
    if (events.length < min) continue;
    findings.push({
      detector: "assumption_failure",
      severity: events.length >= min * 2 ? "error" : "warning",
      title: `Shared root cause across ${events.length} failures`,
      detail:
        `${events.length} failed spans share the same root-cause signature ` +
        `(${key}). The agent likely holds a false assumption that all of these ` +
        `depend on. Inspect the earliest span for the original premise.`,
      span_ids: events.map((e) => e.span_id),
      data: {
        root_cause: key,
        count: events.length,
        first_span_id: events[0]?.span_id,
      },
    });
  }
  return findings;
}

/**
 * Critical path to the first hard failure: root → … → first `fail` span
 * (or first tool span with ok=false).
 */
export function criticalPathToFailure(graph: ReasoningGraph): string[] {
  let failNode: GraphNode | undefined;
  // prefer earliest by ts, else first in pre-order
  const ordered = flattenGraph(graph);
  for (const node of ordered) {
    const e = node.event;
    const failed =
      e.kind === "fail" ||
      (typeof e.metadata?.ok === "boolean" && e.metadata.ok === false);
    if (failed) {
      failNode = node;
      break;
    }
  }
  if (!failNode) return [];
  return pathToSpan(graph, failNode.event.span_id).map((n) => n.event.span_id);
}

/**
 * Run all detectors and assemble an AnalysisResult.
 * A clean trace produces zero findings and an empty critical path.
 */
export function analyze(
  graph: ReasoningGraph,
  options: DetectorOptions = {},
): AnalysisResult {
  const findings: Finding[] = [
    ...detectLoops(graph, options),
    ...detectStalls(graph, options),
    ...detectAssumptionFailures(graph, options),
  ];

  const path = criticalPathToFailure(graph);
  if (path.length > 0) {
    const failId = path[path.length - 1]!;
    findings.push({
      detector: "critical_path",
      severity: "info",
      title: `Critical path to failure (${path.length} spans)`,
      detail:
        `Trace fails at span ${failId}. Ancestor chain: ${path.join(" → ")}. ` +
        `Start debugging at the root of this path.`,
      span_ids: path,
      data: { fail_span_id: failId, length: path.length },
    });
  }

  return {
    stats: graph.stats,
    findings,
    critical_path: path,
  };
}

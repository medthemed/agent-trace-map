import { analyze, type DetectorOptions } from "./detectors.js";
import type { AnalysisResult, ReasoningGraph, TraceKind } from "./types.js";

export interface ToolCount {
  tool: string;
  count: number;
  failed: number;
  total_duration_ms: number;
}

export interface DurationStats {
  min_ms: number;
  max_ms: number;
  avg_ms: number;
  total_ms: number;
  /** 95th percentile duration. */
  p95_ms: number;
}

export interface StatsSummary {
  spans: number;
  roots: number;
  max_depth: number;
  orphans: number;
  by_kind: Record<TraceKind, number>;
  duration: DurationStats;
  /** Tools sorted by call count, then name. */
  tools: ToolCount[];
  findings: {
    total: number;
    by_detector: Record<string, number>;
    by_severity: Record<string, number>;
  };
  critical_path_length: number;
  has_failure: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function isFailedSpan(
  kind: string,
  metadata: Record<string, unknown> | undefined,
  outcome: string | undefined,
): boolean {
  if (kind === "fail") return true;
  if (typeof metadata?.ok === "boolean" && metadata.ok === false) return true;
  if (typeof outcome === "string" && /\b(fail|error|denied|timeout)\b/i.test(outcome)) {
    return true;
  }
  return false;
}

/**
 * Build a compact operational summary of a trace: counts, duration
 * distribution, tool usage, and finding rollup.
 *
 * Run detectors once and fold their result into the summary so callers
 * do not need a separate `analyze` call.
 */
export function summarizeStats(
  graph: ReasoningGraph,
  options: DetectorOptions = {},
): StatsSummary {
  const durations: number[] = [];
  const toolMap = new Map<string, ToolCount>();

  for (const node of graph.nodes.values()) {
    const e = node.event;
    durations.push(e.duration_ms);

    const tool = typeof e.metadata?.tool === "string" ? e.metadata.tool : null;
    if (tool) {
      const entry = toolMap.get(tool) ?? {
        tool,
        count: 0,
        failed: 0,
        total_duration_ms: 0,
      };
      entry.count++;
      entry.total_duration_ms += e.duration_ms;
      if (isFailedSpan(e.kind, e.metadata, e.outcome)) entry.failed++;
      toolMap.set(tool, entry);
    }
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const total =
    sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) : 0;
  const duration: DurationStats = {
    min_ms: sorted[0] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
    avg_ms: sorted.length > 0 ? Math.round(total / sorted.length) : 0,
    total_ms: total,
    p95_ms: percentile(sorted, 95),
  };

  const tools = [...toolMap.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.tool < b.tool ? -1 : 1;
  });

  const result: AnalysisResult = analyze(graph, options);
  const byDetector: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const f of result.findings) {
    byDetector[f.detector] = (byDetector[f.detector] ?? 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }

  return {
    spans: graph.stats.total_spans,
    roots: graph.stats.roots,
    max_depth: graph.stats.max_depth,
    orphans: graph.stats.orphan_spans,
    by_kind: { ...graph.stats.by_kind },
    duration,
    tools,
    findings: {
      total: result.findings.length,
      by_detector: byDetector,
      by_severity: bySeverity,
    },
    critical_path_length: result.critical_path.length,
    has_failure: result.critical_path.length > 0,
  };
}

/** Format a StatsSummary as human-readable text. */
export function formatStats(summary: StatsSummary, topTools = 5): string {
  const lines: string[] = [];
  lines.push("trace stats");
  lines.push(`  spans:      ${summary.spans}`);
  lines.push(`  roots:      ${summary.roots}`);
  lines.push(`  max_depth:  ${summary.max_depth}`);
  lines.push(`  orphans:    ${summary.orphans}`);
  lines.push(
    `  by_kind:    ${Object.entries(summary.by_kind)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  lines.push(
    `  duration:   total=${summary.duration.total_ms}ms ` +
      `min=${summary.duration.min_ms}ms avg=${summary.duration.avg_ms}ms ` +
      `p95=${summary.duration.p95_ms}ms max=${summary.duration.max_ms}ms`,
  );

  if (summary.tools.length > 0) {
    const shown = summary.tools.slice(0, topTools);
    lines.push(`  tools:`);
    for (const t of shown) {
      const failNote = t.failed > 0 ? ` (${t.failed} failed)` : "";
      lines.push(
        `    ${t.tool}: ${t.count} call(s), ${t.total_duration_ms}ms${failNote}`,
      );
    }
    if (summary.tools.length > topTools) {
      lines.push(`    … +${summary.tools.length - topTools} more`);
    }
  }

  lines.push(`  findings:   ${summary.findings.total}`);
  if (summary.findings.total > 0) {
    const by = Object.entries(summary.findings.by_detector)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`    by_detector: ${by}`);
    const sev = Object.entries(summary.findings.by_severity)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`    by_severity: ${sev}`);
  }

  if (summary.has_failure) {
    lines.push(`  critical_path: ${summary.critical_path_length} span(s) to first failure`);
  } else {
    lines.push(`  critical_path: none`);
  }

  return lines.join("\n");
}

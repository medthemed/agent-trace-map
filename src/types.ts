/**
 * Trace event types for agent reasoning traces.
 *
 * Each line of a JSONL trace is one TraceEvent. Events form a tree via
 * span_id / parent_span_id, similar to OpenTelemetry spans but with
 * agent-specific kinds (plan | tool | reflect | fail | commit).
 */

export const TRACE_KINDS = [
  "plan",
  "tool",
  "reflect",
  "fail",
  "commit",
] as const;

export type TraceKind = (typeof TRACE_KINDS)[number];

export function isTraceKind(v: unknown): v is TraceKind {
  return typeof v === "string" && (TRACE_KINDS as readonly string[]).includes(v);
}

/** One span in the agent reasoning trace. */
export interface TraceEvent {
  /** Unique span id. */
  span_id: string;
  /** Parent span id; null/absent for roots. */
  parent_span_id?: string | null;
  /** What kind of step this was. */
  kind: TraceKind;
  /** Pointer to the prompt / instruction that produced this span. */
  prompt_ref?: string;
  /** Short human-readable outcome (success message, error text, tool result summary). */
  outcome?: string;
  /** Wall-clock duration of the span in milliseconds. */
  duration_ms: number;
  /** Optional ISO-8601 start time (used for stall gap analysis). */
  ts?: string;
  /** Free-form key/value context (tool name, token counts, error codes…). */
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  event: TraceEvent;
  children: GraphNode[];
  /** Depth from root (0 = root). */
  depth: number;
}

export interface GraphStats {
  total_spans: number;
  roots: number;
  max_depth: number;
  by_kind: Record<TraceKind, number>;
  total_duration_ms: number;
  /** Number of spans with a missing parent reference. */
  orphan_spans: number;
}

export interface ReasoningGraph {
  roots: GraphNode[];
  nodes: Map<string, GraphNode>;
  stats: GraphStats;
}

export type FindingSeverity = "info" | "warning" | "error";

export interface Finding {
  /** Detector id, e.g. `loop`, `stall`, `assumption_failure`, `critical_path`. */
  detector: string;
  severity: FindingSeverity;
  /** One-line summary. */
  title: string;
  /** Longer explanation. */
  detail: string;
  /** Span ids involved. */
  span_ids: string[];
  /** Detector-specific payload. */
  data?: Record<string, unknown>;
}

export interface AnalysisResult {
  stats: GraphStats;
  findings: Finding[];
  /** Ordered span ids on the critical path to first failure (if any). */
  critical_path: string[];
}

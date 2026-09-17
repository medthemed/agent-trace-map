# Architecture

## Why agent-trace-map exists

OpenTelemetry-style spans show *what tools ran* and *how long they took*.
They do not show the reasoning loop: the agent retried the same call five
times, sat idle waiting on a hung tool, or failed every task that depended
on one false assumption.

`agent-trace-map` (CLI: `atm`) treats a JSONL event log as a **reasoning
graph** and runs detectors that surface those failure modes.

## Module map

```
src/
  types.ts      TraceEvent, TraceKind, Graph, Finding types
  parse.ts      JSONL → TraceEvent[] with per-line error collection
  graph.ts      Event list → forest (span_id / parent_span_id)
  detectors.ts  loop / stall / assumption_failure / critical_path
  cli.ts        `atm analyze <trace.jsonl> [--json]`
  index.ts      Public library surface
```

All functions are pure. No network, no clock reads at runtime (timestamps
come from the trace).

## Trace event schema

```json
{
  "span_id": "t1",
  "parent_span_id": "p0",
  "kind": "plan | tool | reflect | fail | commit",
  "prompt_ref": "prompts/fix.md",
  "outcome": "human-readable result",
  "duration_ms": 120,
  "ts": "2026-01-15T10:00:00.000Z",
  "metadata": { "tool": "http_get", "ok": false, "error_code": "ECONNREFUSED" }
}
```

Required: `span_id`, `kind`, `duration_ms`. Everything else is optional.
Invalid lines are reported with line numbers; valid lines still analyze.

## Graph construction

1. Index events by `span_id` (first occurrence wins).
2. Attach each node to its parent. Missing parents → orphan roots.
3. Detect cycles during attach and detach the edge so the structure stays
   a forest (flatten always terminates).
4. Sort children by `ts` then `span_id` for stable output.
5. Compute depth, per-kind counts, total duration.

## Detectors

### loop
Consecutive spans in pre-order with the same `similarityKey`
(`kind|prompt_ref|tool|normalized-outcome`). Numbers in outcomes are
collapsed so `retry 1` / `retry 2` match. Default threshold: 3 (warning),
6 (error).

### stall
- **Duration stall**: `duration_ms >= stallMs` (default 5000).
- **Gap stall**: when sibling `ts` values exist, the idle time between one
  sibling ending (`ts + duration_ms`) and the next starting exceeds
  `stallGapMs` (default 3000).

### assumption_failure
Failed spans (`kind=fail`, or `tool` with `metadata.ok=false` / fail-ish
outcome) are grouped by root-cause signature
(`error_code|tool|normalized-outcome`). Groups of size ≥ 2 indicate a
shared false assumption.

### critical_path
Walk to the first hard failure (pre-order, earliest `ts`), then emit the
ancestor chain root → … → fail. Purely informational.

## CLI output

Text mode prints graph stats + findings. `--json` emits:

```json
{
  "ok": true,
  "parse_errors": [],
  "stats": { "total_spans": 7, "by_kind": { "...": 0 }, "...": "..." },
  "findings": [ { "detector": "loop", "severity": "warning", "...": "..." } ],
  "critical_path": ["p0", "f1"]
}
```

Exit code `1` only when the file has zero valid events.

## Non-goals (MVP)

- No live instrumentation / OpenTelemetry exporter
- No network access
- No visualization UI (JSON + text only)

import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph.js";
import { formatStats, summarizeStats } from "../src/stats.js";
import type { TraceEvent } from "../src/types.js";

function ev(partial: Partial<TraceEvent> & { span_id: string }): TraceEvent {
  return {
    kind: "plan",
    duration_ms: 10,
    prompt_ref: "p.md",
    ...partial,
  };
}

function loopTrace(): TraceEvent[] {
  const events: TraceEvent[] = [
    ev({ span_id: "root", parent_span_id: null, kind: "plan", duration_ms: 5 }),
  ];
  for (let i = 0; i < 5; i++) {
    events.push(
      ev({
        span_id: `t${i}`,
        parent_span_id: "root",
        kind: "tool",
        outcome: "call failed",
        duration_ms: 100 + i,
        metadata: { tool: "http_get", ok: false, error_code: "ECONNREFUSED" },
      }),
    );
  }
  events.push(
    ev({
      span_id: "f1",
      parent_span_id: "root",
      kind: "fail",
      outcome: "gave up",
      duration_ms: 2,
    }),
  );
  return events;
}

function mixedToolTrace(): TraceEvent[] {
  return [
    ev({ span_id: "p", parent_span_id: null, kind: "plan" }),
    ev({
      span_id: "a",
      parent_span_id: "p",
      kind: "tool",
      duration_ms: 30,
      metadata: { tool: "read_file", ok: true },
    }),
    ev({
      span_id: "b",
      parent_span_id: "p",
      kind: "tool",
      duration_ms: 40,
      metadata: { tool: "read_file", ok: true },
    }),
    ev({
      span_id: "c",
      parent_span_id: "p",
      kind: "tool",
      duration_ms: 200,
      metadata: { tool: "http_get", ok: false },
      outcome: "timeout",
    }),
  ];
}

describe("summarizeStats", () => {
  it("counts spans, kinds, and duration distribution", () => {
    const summary = summarizeStats(buildGraph(loopTrace()));
    expect(summary.spans).toBe(7);
    expect(summary.by_kind.plan).toBe(1);
    expect(summary.by_kind.tool).toBe(5);
    expect(summary.by_kind.fail).toBe(1);
    expect(summary.duration.min_ms).toBe(2);
    expect(summary.duration.max_ms).toBe(104);
    expect(summary.duration.total_ms).toBe(5 + 100 + 101 + 102 + 103 + 104 + 2);
    expect(summary.duration.avg_ms).toBeGreaterThan(0);
    expect(summary.duration.p95_ms).toBeGreaterThanOrEqual(summary.duration.avg_ms);
  });

  it("aggregates tools by name with failure counts", () => {
    const summary = summarizeStats(buildGraph(mixedToolTrace()));
    const read = summary.tools.find((t) => t.tool === "read_file");
    const http = summary.tools.find((t) => t.tool === "http_get");
    expect(read?.count).toBe(2);
    expect(read?.failed).toBe(0);
    expect(http?.count).toBe(1);
    expect(http?.failed).toBe(1);
    // sorted by count descending
    expect(summary.tools[0]?.tool).toBe("read_file");
  });

  it("rolls up findings by detector and severity", () => {
    const summary = summarizeStats(buildGraph(loopTrace()));
    expect(summary.findings.total).toBeGreaterThan(0);
    expect(summary.findings.by_detector.loop).toBe(1);
    expect(summary.findings.by_detector.assumption_failure).toBe(1);
    expect(summary.has_failure).toBe(true);
    expect(summary.critical_path_length).toBeGreaterThan(0);
  });

  it("reports a clean summary for a healthy trace", () => {
    const events: TraceEvent[] = [
      ev({ span_id: "a", parent_span_id: null, kind: "plan", outcome: "ok" }),
      ev({
        span_id: "b",
        parent_span_id: "a",
        kind: "tool",
        outcome: "read",
        metadata: { tool: "read_file", ok: true },
      }),
      ev({ span_id: "c", parent_span_id: "a", kind: "commit", outcome: "done" }),
    ];
    const summary = summarizeStats(buildGraph(events));
    expect(summary.findings.total).toBe(0);
    expect(summary.has_failure).toBe(false);
    expect(summary.critical_path_length).toBe(0);
  });
});

describe("formatStats", () => {
  it("renders a readable block", () => {
    const text = formatStats(summarizeStats(buildGraph(loopTrace())));
    expect(text).toContain("trace stats");
    expect(text).toContain("spans:      7");
    expect(text).toContain("http_get: 5 call(s)");
    expect(text).toContain("(5 failed)");
    expect(text).toContain("findings:");
    expect(text).toContain("critical_path:");
  });

  it("honors --top for tool listing", () => {
    const events: TraceEvent[] = [
      ev({ span_id: "p", parent_span_id: null }),
      ...["t1", "t2", "t3", "t4"].map((id) =>
        ev({
          span_id: id,
          parent_span_id: "p",
          kind: "tool",
          metadata: { tool: `tool_${id}`, ok: true },
        }),
      ),
    ];
    const summary = summarizeStats(buildGraph(events));
    const text = formatStats(summary, 2);
    expect(text).toContain("… +2 more");
    expect(text.split("\n").filter((l) => l.includes("call(s)"))).toHaveLength(2);
  });
});

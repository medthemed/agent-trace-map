import { describe, expect, it } from "vitest";
import {
  analyze,
  criticalPathToFailure,
  detectAssumptionFailures,
  detectLoops,
  detectStalls,
  similarityKey,
} from "../src/detectors.js";
import { buildGraph } from "../src/graph.js";
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
  const events: TraceEvent[] = [ev({ span_id: "root", parent_span_id: null, kind: "plan" })];
  for (let i = 0; i < 5; i++) {
    events.push(
      ev({
        span_id: `t${i}`,
        parent_span_id: "root",
        kind: "tool",
        outcome: "call failed",
        metadata: { tool: "http_get", ok: false, error_code: "ECONNREFUSED" },
      }),
    );
  }
  return events;
}

function cleanTrace(): TraceEvent[] {
  return [
    ev({ span_id: "a", parent_span_id: null, kind: "plan", outcome: "plan ready" }),
    ev({
      span_id: "b",
      parent_span_id: "a",
      kind: "tool",
      outcome: "read config",
      metadata: { tool: "read_file", ok: true },
    }),
    ev({ span_id: "c", parent_span_id: "a", kind: "reflect", outcome: "looks good" }),
    ev({ span_id: "d", parent_span_id: "c", kind: "commit", outcome: "shipped" }),
  ];
}

describe("similarityKey", () => {
  it("collapses numeric differences in outcome", () => {
    const a = similarityKey(ev({ span_id: "1", kind: "tool", outcome: "retry 1" }));
    const b = similarityKey(ev({ span_id: "2", kind: "tool", outcome: "retry 2" }));
    expect(a).toBe(b);
  });
  it("differs by kind", () => {
    const a = similarityKey(ev({ span_id: "1", kind: "tool", outcome: "x" }));
    const b = similarityKey(ev({ span_id: "2", kind: "plan", outcome: "x" }));
    expect(a).not.toBe(b);
  });
});

describe("detectLoops", () => {
  it("flags a run of similar tool spans", () => {
    const graph = buildGraph(loopTrace());
    const findings = detectLoops(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detector).toBe("loop");
    expect(findings[0]?.span_ids.length).toBe(5);
    expect(findings[0]?.severity).toBe("warning");
  });

  it("escalates severity on very long runs", () => {
    const events: TraceEvent[] = [ev({ span_id: "root" })];
    for (let i = 0; i < 10; i++) {
      events.push(
        ev({
          span_id: `t${i}`,
          parent_span_id: "root",
          kind: "tool",
          outcome: "same",
        }),
      );
    }
    const findings = detectLoops(buildGraph(events));
    expect(findings[0]?.severity).toBe("error");
  });

  it("does not flag clean traces", () => {
    expect(detectLoops(buildGraph(cleanTrace()))).toHaveLength(0);
  });
});

describe("detectStalls", () => {
  it("flags long-running spans", () => {
    const graph = buildGraph([
      ev({ span_id: "slow", duration_ms: 9000, kind: "tool" }),
    ]);
    const findings = detectStalls(graph, { stallMs: 5000 });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detector).toBe("stall");
    expect(findings[0]?.title).toMatch(/9000ms/);
  });

  it("flags idle gaps between siblings when ts present", () => {
    const graph = buildGraph([
      ev({ span_id: "p", parent_span_id: null }),
      ev({
        span_id: "a",
        parent_span_id: "p",
        ts: "2026-01-15T10:00:00.000Z",
        duration_ms: 100,
      }),
      ev({
        span_id: "b",
        parent_span_id: "p",
        ts: "2026-01-15T10:00:10.000Z",
        duration_ms: 100,
      }),
    ]);
    const findings = detectStalls(graph, { stallMs: 60_000, stallGapMs: 3000 });
    expect(findings.some((f) => f.title.includes("Idle gap"))).toBe(true);
  });

  it("does not flag fast clean traces", () => {
    expect(detectStalls(buildGraph(cleanTrace()))).toHaveLength(0);
  });
});

describe("detectAssumptionFailures", () => {
  it("groups failed tools by shared root cause", () => {
    const findings = detectAssumptionFailures(buildGraph(loopTrace()), {
      assumptionFailureMin: 2,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detector).toBe("assumption_failure");
    expect(findings[0]?.data?.root_cause).toContain("ECONNREFUSED");
  });

  it("returns empty when failures do not share a cause", () => {
    const graph = buildGraph([
      ev({
        span_id: "f1",
        kind: "fail",
        outcome: "auth error",
        metadata: { error_code: "E401" },
      }),
      ev({
        span_id: "f2",
        kind: "fail",
        outcome: "disk full",
        metadata: { error_code: "ENOSPC" },
      }),
    ]);
    expect(detectAssumptionFailures(graph)).toHaveLength(0);
  });
});

describe("criticalPathToFailure", () => {
  it("returns the ancestor chain to the first fail", () => {
    const graph = buildGraph([
      ev({ span_id: "a", parent_span_id: null }),
      ev({ span_id: "b", parent_span_id: "a", kind: "tool" }),
      ev({ span_id: "c", parent_span_id: "b", kind: "fail", outcome: "boom" }),
    ]);
    expect(criticalPathToFailure(graph)).toEqual(["a", "b", "c"]);
  });

  it("returns empty when there is no failure", () => {
    expect(criticalPathToFailure(buildGraph(cleanTrace()))).toEqual([]);
  });
});

describe("analyze", () => {
  it("clean trace yields no findings", () => {
    const result = analyze(buildGraph(cleanTrace()));
    expect(result.findings).toHaveLength(0);
    expect(result.critical_path).toEqual([]);
    expect(result.stats.total_spans).toBe(4);
  });

  it("loop trace yields loop + assumption_failure + critical_path", () => {
    const result = analyze(buildGraph(loopTrace()));
    const detectors = result.findings.map((f) => f.detector);
    expect(detectors).toContain("loop");
    expect(detectors).toContain("assumption_failure");
    expect(detectors).toContain("critical_path");
    expect(result.critical_path.length).toBeGreaterThan(0);
  });
});

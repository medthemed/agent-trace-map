import { describe, expect, it } from "vitest";
import { buildGraph, flattenGraph, pathToSpan } from "../src/graph.js";
import type { TraceEvent } from "../src/types.js";

function ev(partial: Partial<TraceEvent> & { span_id: string }): TraceEvent {
  return {
    kind: "plan",
    duration_ms: 1,
    ...partial,
  };
}

describe("buildGraph", () => {
  it("builds a simple parent/child tree", () => {
    const graph = buildGraph([
      ev({ span_id: "a", parent_span_id: null }),
      ev({ span_id: "b", parent_span_id: "a", kind: "tool" }),
      ev({ span_id: "c", parent_span_id: "b", kind: "commit" }),
    ]);
    expect(graph.stats.total_spans).toBe(3);
    expect(graph.stats.roots).toBe(1);
    expect(graph.stats.max_depth).toBe(2);
    expect(graph.stats.by_kind.plan).toBe(1);
    expect(graph.stats.by_kind.tool).toBe(1);
    expect(graph.stats.by_kind.commit).toBe(1);
    expect(graph.nodes.get("a")?.children.map((c) => c.event.span_id)).toEqual(["b"]);
  });

  it("treats missing parents as orphan roots", () => {
    const graph = buildGraph([
      ev({ span_id: "a", parent_span_id: null }),
      ev({ span_id: "orphan", parent_span_id: "missing" }),
    ]);
    expect(graph.stats.roots).toBe(2);
    expect(graph.stats.orphan_spans).toBe(1);
  });

  it("detaches cycles to keep a forest", () => {
    const graph = buildGraph([
      ev({ span_id: "a", parent_span_id: "b" }),
      ev({ span_id: "b", parent_span_id: "a" }),
    ]);
    expect(graph.stats.total_spans).toBe(2);
    expect(graph.stats.roots).toBeGreaterThanOrEqual(1);
    // flatten should still terminate
    expect(flattenGraph(graph)).toHaveLength(2);
  });

  it("keeps first occurrence on duplicate span ids", () => {
    const graph = buildGraph([
      ev({ span_id: "dup", outcome: "first" }),
      ev({ span_id: "dup", outcome: "second" }),
    ]);
    expect(graph.stats.total_spans).toBe(1);
    expect(graph.nodes.get("dup")?.event.outcome).toBe("first");
  });
});

describe("pathToSpan", () => {
  it("returns the root-to-node chain", () => {
    const graph = buildGraph([
      ev({ span_id: "a", parent_span_id: null }),
      ev({ span_id: "b", parent_span_id: "a" }),
      ev({ span_id: "c", parent_span_id: "b", kind: "fail" }),
    ]);
    expect(pathToSpan(graph, "c").map((n) => n.event.span_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns empty for unknown span", () => {
    const graph = buildGraph([ev({ span_id: "a" })]);
    expect(pathToSpan(graph, "zzz")).toEqual([]);
  });
});

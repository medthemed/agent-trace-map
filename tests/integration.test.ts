import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/detectors.js";
import { assertParseable } from "../src/errors.js";
import { buildGraph, flattenGraph } from "../src/graph.js";
import { parseJsonl } from "../src/parse.js";
import { PUBLIC_API_NAMES } from "../src/public-api.js";
import { summarizeStats } from "../src/stats.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");

const exampleFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".jsonl"))
  .sort();

/**
 * End-to-end integration over every shipped example trace:
 * parse → assertParseable → buildGraph → analyze → stats.
 */
describe("integration: examples/*.jsonl", () => {
  it("ships at least three example traces", () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(3);
    expect(exampleFiles).toContain("clean-trace.jsonl");
    expect(exampleFiles).toContain("loop-trace.jsonl");
    expect(exampleFiles).toContain("stall-trace.jsonl");
  });

  for (const file of exampleFiles) {
    describe(file, () => {
      const text = readFileSync(join(examplesDir, file), "utf8");
      const { events, errors } = parseJsonl(text);

      it("parses with zero errors", () => {
        expect(errors).toEqual([]);
        expect(events.length).toBeGreaterThan(0);
        expect(() => assertParseable(events, errors, file)).not.toThrow();
      });

      it("builds a graph and runs detectors", () => {
        const graph = buildGraph(events);
        expect(graph.stats.total_spans).toBe(events.length);
        expect(graph.roots.length).toBeGreaterThan(0);

        const result = analyze(graph);
        expect(result.stats.total_spans).toBe(events.length);
        // every finding references known spans
        for (const finding of result.findings) {
          for (const id of finding.span_ids) {
            expect(graph.nodes.has(id)).toBe(true);
          }
        }

        const flat = flattenGraph(graph);
        expect(flat.length).toBe(events.length);
      });

      it("summarizes stats without throwing", () => {
        const graph = buildGraph(events);
        const summary = summarizeStats(graph);
        expect(summary.spans).toBe(events.length);
        expect(summary.duration.total_ms).toBeGreaterThanOrEqual(0);
        expect(summary.findings.total).toBeGreaterThanOrEqual(0);
      });
    });
  }

  it("clean trace produces zero findings", () => {
    const text = readFileSync(join(examplesDir, "clean-trace.jsonl"), "utf8");
    const { events } = parseJsonl(text);
    const result = analyze(buildGraph(events));
    expect(result.findings).toEqual([]);
    expect(result.critical_path).toEqual([]);
  });

  it("loop trace produces loop and assumption findings", () => {
    const text = readFileSync(join(examplesDir, "loop-trace.jsonl"), "utf8");
    const { events } = parseJsonl(text);
    const result = analyze(buildGraph(events));
    const detectors = result.findings.map((f) => f.detector);
    expect(detectors).toContain("loop");
    expect(detectors).toContain("assumption_failure");
    expect(result.critical_path.length).toBeGreaterThan(0);
  });

  it("stall trace produces a stall finding", () => {
    const text = readFileSync(join(examplesDir, "stall-trace.jsonl"), "utf8");
    const { events } = parseJsonl(text);
    const result = analyze(buildGraph(events));
    expect(result.findings.some((f) => f.detector === "stall")).toBe(true);
  });

  it("exposes a frozen public API name list", () => {
    expect(PUBLIC_API_NAMES).toContain("AnalysisError");
    expect(PUBLIC_API_NAMES).toContain("TraceParseError");
    expect(PUBLIC_API_NAMES).toContain("assertParseable");
    expect(PUBLIC_API_NAMES).toContain("analyze");
    expect(PUBLIC_API_NAMES).toContain("parseJsonl");
    expect(Object.isFrozen(PUBLIC_API_NAMES)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  AnalysisError,
  TraceParseError,
  assertParseable,
  isAnalysisError,
  isTraceParseError,
} from "../src/errors.js";

describe("AnalysisError / TraceParseError", () => {
  it("carries source and parse errors", () => {
    const err = new TraceParseError("no valid events", {
      source: "examples/broken.jsonl",
      parse_errors: [{ line: 1, message: "invalid JSON" }],
    });
    expect(err.name).toBe("TraceParseError");
    expect(err.message).toContain("no valid events");
    expect(err.source).toBe("examples/broken.jsonl");
    expect(err.parse_errors).toHaveLength(1);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err).toBeInstanceOf(TraceParseError);
  });

  it("narrow helpers work", () => {
    const a: unknown = new AnalysisError("boom");
    const t: unknown = new TraceParseError("nope");
    expect(isAnalysisError(a)).toBe(true);
    expect(isAnalysisError(t)).toBe(true);
    expect(isTraceParseError(t)).toBe(true);
    expect(isTraceParseError(a)).toBe(false);
    expect(isAnalysisError(new Error("x"))).toBe(false);
  });

  it("assertParseable passes when events exist", () => {
    expect(() =>
      assertParseable([{ span_id: "a" }], [], "t.jsonl"),
    ).not.toThrow();
  });

  it("assertParseable throws TraceParseError on empty event list", () => {
    try {
      assertParseable(
        [],
        [
          { line: 1, message: "bad" },
          { line: 2, message: "worse" },
        ],
        "t.jsonl",
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(isTraceParseError(err)).toBe(true);
      const e = err as TraceParseError;
      expect(e.message).toContain("t.jsonl");
      expect(e.message).toContain("line 1");
      expect(e.parse_errors).toHaveLength(2);
    }
  });
});

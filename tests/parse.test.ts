import { describe, expect, it } from "vitest";
import { coerceEvent, parseJsonl } from "../src/parse.js";

const valid = {
  span_id: "a1",
  parent_span_id: null,
  kind: "plan",
  duration_ms: 10,
  outcome: "ok",
};

describe("coerceEvent", () => {
  it("accepts a minimal valid event", () => {
    const e = coerceEvent(valid, 1);
    expect("span_id" in e).toBe(true);
    expect((e as { kind: string }).kind).toBe("plan");
  });

  it("rejects missing span_id", () => {
    const e = coerceEvent({ ...valid, span_id: "" }, 2);
    expect(e).toMatchObject({ line: 2 });
    expect((e as { message: string }).message).toMatch(/span_id/);
  });

  it("rejects unknown kind", () => {
    const e = coerceEvent({ ...valid, kind: "dance" }, 3);
    expect((e as { message: string }).message).toMatch(/kind/);
  });

  it("rejects negative duration", () => {
    const e = coerceEvent({ ...valid, duration_ms: -1 }, 4);
    expect((e as { message: string }).message).toMatch(/duration_ms/);
  });

  it("rejects non-object", () => {
    const e = coerceEvent("nope", 5);
    expect((e as { message: string }).message).toMatch(/JSON object/);
  });
});

describe("parseJsonl", () => {
  it("parses multiple events and skips blanks", () => {
    const text = [
      JSON.stringify(valid),
      "",
      JSON.stringify({ ...valid, span_id: "a2", parent_span_id: "a1", kind: "tool" }),
    ].join("\n");
    const { events, errors } = parseJsonl(text);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[1]?.parent_span_id).toBe("a1");
  });

  it("collects JSON syntax errors with line numbers", () => {
    const text = [JSON.stringify(valid), "{not json", ""].join("\n");
    const { events, errors } = parseJsonl(text);
    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toMatch(/invalid JSON/);
  });

  it("collects schema errors and keeps valid events", () => {
    const text = [
      JSON.stringify(valid),
      JSON.stringify({ span_id: "x", kind: "nope", duration_ms: 1 }),
    ].join("\n");
    const { events, errors } = parseJsonl(text);
    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
  });

  it("handles CRLF line endings", () => {
    const text = JSON.stringify(valid) + "\r\n" + JSON.stringify({ ...valid, span_id: "b" });
    const { events, errors } = parseJsonl(text);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
  });
});

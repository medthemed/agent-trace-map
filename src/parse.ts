import { isTraceKind, type TraceEvent, type TraceKind } from "./types.js";

export interface ParseError {
  /** 1-based line number in the JSONL source. */
  line: number;
  message: string;
}

export interface ParseResult {
  events: TraceEvent[];
  errors: ParseError[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asOptionalString(v: unknown): string | undefined | null {
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

/**
 * Validate a single parsed JSON value as a TraceEvent.
 * Returns an error message, or the event on success.
 */
export function coerceEvent(value: unknown, line: number): TraceEvent | ParseError {
  const fail = (message: string): ParseError => ({ line, message });

  if (!isRecord(value)) return fail("event must be a JSON object");

  const span_id = value.span_id;
  if (typeof span_id !== "string" || span_id.trim() === "") {
    return fail("span_id must be a non-empty string");
  }

  if (!isTraceKind(value.kind)) {
    return fail(
      `kind must be one of plan|tool|reflect|fail|commit, got ${JSON.stringify(value.kind)}`,
    );
  }

  const duration_ms = value.duration_ms;
  if (
    typeof duration_ms !== "number" ||
    !Number.isFinite(duration_ms) ||
    duration_ms < 0
  ) {
    return fail("duration_ms must be a non-negative finite number");
  }

  const parent = asOptionalString(value.parent_span_id);
  if (parent === undefined && value.parent_span_id !== undefined) {
    return fail("parent_span_id must be a string or null");
  }

  if (value.prompt_ref !== undefined && typeof value.prompt_ref !== "string") {
    return fail("prompt_ref must be a string");
  }
  if (value.outcome !== undefined && typeof value.outcome !== "string") {
    return fail("outcome must be a string");
  }
  if (value.ts !== undefined && typeof value.ts !== "string") {
    return fail("ts must be an ISO-8601 string");
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return fail("metadata must be an object");
  }

  const event: TraceEvent = {
    span_id,
    kind: value.kind as TraceKind,
    duration_ms,
  };
  if (typeof value.parent_span_id === "string") {
    event.parent_span_id = value.parent_span_id;
  } else if (value.parent_span_id === null) {
    event.parent_span_id = null;
  }
  if (typeof value.prompt_ref === "string") event.prompt_ref = value.prompt_ref;
  if (typeof value.outcome === "string") event.outcome = value.outcome;
  if (typeof value.ts === "string") event.ts = value.ts;
  if (isRecord(value.metadata)) {
    event.metadata = value.metadata as Record<string, unknown>;
  }
  return event;
}

function isParseError(v: unknown): v is ParseError {
  return isRecord(v) && typeof v.line === "number" && typeof v.message === "string";
}

/**
 * Parse a JSONL trace log. Blank lines are skipped.
 * Invalid lines are collected as errors; valid events are still returned
 * so partial traces remain analyzable.
 */
export function parseJsonl(text: string): ParseResult {
  const events: TraceEvent[] = [];
  const errors: ParseError[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ line, message: `invalid JSON: ${msg}` });
      continue;
    }

    const coerced = coerceEvent(parsed, line);
    if (isParseError(coerced)) {
      errors.push(coerced);
    } else {
      events.push(coerced);
    }
  }

  return { events, errors };
}

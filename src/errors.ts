/**
 * Typed errors for agent-trace-map.
 *
 * Parse-time problems stay in `ParseError` (line-scoped, non-throwing).
 * Analysis-time failures raise `AnalysisError` so callers can instanceof
 * instead of string-matching messages.
 */

export class AnalysisError extends Error {
  /** Optional source path or label for the failing trace. */
  readonly source?: string;
  /** Underlying parse errors when analysis could not proceed. */
  readonly parse_errors?: Array<{ line: number; message: string }>;

  constructor(
    message: string,
    opts: {
      source?: string;
      parse_errors?: Array<{ line: number; message: string }>;
    } = {},
  ) {
    super(message);
    this.name = "AnalysisError";
    this.source = opts.source;
    this.parse_errors = opts.parse_errors;
    Object.setPrototypeOf(this, AnalysisError.prototype);
  }
}

/**
 * Raised when a JSONL document cannot yield a usable graph at all
 * (zero valid events, or a hard structural failure).
 */
export class TraceParseError extends AnalysisError {
  constructor(
    message: string,
    opts: {
      source?: string;
      parse_errors?: Array<{ line: number; message: string }>;
    } = {},
  ) {
    super(message, opts);
    this.name = "TraceParseError";
    Object.setPrototypeOf(this, TraceParseError.prototype);
  }
}

export function isAnalysisError(err: unknown): err is AnalysisError {
  return err instanceof AnalysisError;
}

export function isTraceParseError(err: unknown): err is TraceParseError {
  return err instanceof TraceParseError;
}

/**
 * Assert that a parse result has at least one event; otherwise throw
 * TraceParseError carrying the collected line errors.
 */
export function assertParseable(
  events: unknown[],
  parse_errors: Array<{ line: number; message: string }>,
  source?: string,
): void {
  if (events.length > 0) return;
  const preview = parse_errors
    .slice(0, 5)
    .map((e) => `  line ${e.line}: ${e.message}`)
    .join("\n");
  const more =
    parse_errors.length > 5 ? `\n  … +${parse_errors.length - 5} more` : "";
  throw new TraceParseError(
    `no valid events in ${source ?? "trace"}\n${preview}${more}`,
    { source, parse_errors },
  );
}

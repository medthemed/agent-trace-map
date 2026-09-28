/**
 * Stable machine-readable output contract for the atm CLI.
 *
 * Every `--format json` payload is wrapped in a small envelope:
 *   { schema_version, ok, command, ...payload }
 *
 * `schema_version` is currently `"1"`. Additive fields may appear in
 * later versions; existing fields will not be renamed or removed
 * within the same major schema_version.
 */

import type { AnalysisResult, Finding } from "./types.js";
import type { StatsSummary } from "./stats.js";
import type { ParseError } from "./parse.js";
import type {
  TraceBatchAggregate,
  TraceBatchFileResult,
} from "./batch.js";

/** Current JSON output schema version (string, bumped on breaking change). */
export const OUTPUT_SCHEMA_VERSION = "1" as const;

export type OutputFormat = "text" | "json";

export interface AnalyzeJson {
  schema_version: typeof OUTPUT_SCHEMA_VERSION;
  ok: boolean;
  command: "analyze";
  file: string;
  parse_errors: ParseError[];
  stats: AnalysisResult["stats"] | null;
  findings: Finding[];
  critical_path: string[];
}

export interface StatsJson {
  schema_version: typeof OUTPUT_SCHEMA_VERSION;
  ok: boolean;
  command: "stats";
  file: string;
  parse_errors: ParseError[];
  summary: StatsSummary | null;
}

export interface AnalyzeManyJson {
  schema_version: typeof OUTPUT_SCHEMA_VERSION;
  ok: boolean;
  command: "analyze-many";
  dir: string;
  files: TraceBatchFileResult[];
  aggregate: TraceBatchAggregate;
}

export type CliJsonOutput = AnalyzeJson | StatsJson | AnalyzeManyJson;

/** Serialize any CLI JSON payload with pretty-printing. */
export function toJsonLine(payload: CliJsonOutput): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse a `--format` flag value. Returns undefined for missing/empty.
 * Throws on unknown values so the CLI can fail with a clear message.
 */
export function parseOutputFormat(
  value: string | undefined,
): OutputFormat | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "") return undefined;
  if (v === "json") return "json";
  if (v === "text") return "text";
  throw new Error(`unknown --format "${value}"; expected json or text`);
}

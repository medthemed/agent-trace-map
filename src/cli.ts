#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeMany, formatFindingsTable, type TraceBatchResult } from "./batch.js";
import {
  ConfigError,
  configToDetectorOptions,
  loadConfig,
  loadConfigFromDir,
  type AtmConfig,
} from "./config.js";
import { analyze, type DetectorOptions } from "./detectors.js";
import {
  OUTPUT_SCHEMA_VERSION,
  parseOutputFormat,
  type AnalyzeJson,
  type AnalyzeManyJson,
  type OutputFormat,
  type StatsJson,
} from "./format.js";
import { buildGraph } from "./graph.js";
import { parseJsonl } from "./parse.js";
import { formatStats, summarizeStats } from "./stats.js";
import type { AnalysisResult, Finding } from "./types.js";

const USAGE = `atm — agent-trace-map

Usage:
  atm analyze <trace.jsonl> [--format json] [--stall-ms N] [--loop-threshold N] [--config <path>]
  atm analyze-many <dir>    [--format json] [--stall-ms N] [--loop-threshold N] [--config <path>]
  atm stats   <trace.jsonl> [--format json] [--top N] [--config <path>]

Commands:
  analyze       Parse a JSONL trace, build the reasoning graph, run detectors
  analyze-many  Analyze every *.jsonl in a directory; print aggregate findings table
  stats         Compact summary: counts, durations, tools, finding rollup

Options:
  --format json|text  Output format (default: text). \`--json\` is a
                      shorthand for \`--format json\`.
  --stall-ms N        Stall duration threshold in ms (default 5000)
  --loop-threshold N  Consecutive similar spans that count as a loop (default 3)
  --top N             Max tools listed in stats output (default 5)
  --config <path>     Load detector thresholds from a JSON config file
                      (also auto-loads atm.config.json from the working directory)
  -h, --help          Show this help

Config file (atm.config.json):
  {
    "loop_threshold": 3,
    "stall_ms": 5000,
    "stall_gap_ms": 3000,
    "assumption_failure_min": 2
  }
`;

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): {
  command: string;
  path?: string;
  format: OutputFormat;
  options: DetectorOptions;
  top: number;
  configPath?: string;
} {
  const options: DetectorOptions = {};
  let jsonShorthand = false;
  let formatValue: string | undefined;
  let command = "";
  let path: string | undefined;
  let top = 5;
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a === "--json") {
      jsonShorthand = true;
    } else if (a === "--format") {
      const v = argv[++i];
      if (v === undefined) fail("error: --format requires a value");
      formatValue = v;
    } else if (a === "--stall-ms") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) fail("error: --stall-ms requires a non-negative number");
      options.stallMs = v;
    } else if (a === "--loop-threshold") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 2) fail("error: --loop-threshold requires an integer >= 2");
      options.loopThreshold = v;
    } else if (a === "--top") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) fail("error: --top requires an integer >= 1");
      top = v;
    } else if (a === "--config") {
      const v = argv[++i];
      if (v === undefined) fail("error: --config requires a path");
      configPath = v;
    } else if (!command) {
      command = a;
    } else if (!path) {
      path = a;
    } else {
      fail(`error: unexpected argument "${a}"`);
    }
  }

  let format: OutputFormat = "text";
  if (jsonShorthand) {
    format = "json";
  } else if (formatValue !== undefined) {
    try {
      format = parseOutputFormat(formatValue) ?? "text";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`error: ${msg}`);
    }
  }

  return { command, path, format, options, top, configPath };
}

/**
 * Load detector options: config file first (cwd auto-load or --config),
 * then explicit CLI flags override.
 */
function resolveOptions(
  configPath: string | undefined,
  cliOptions: DetectorOptions,
): DetectorOptions {
  let config: AtmConfig;
  try {
    config =
      configPath !== undefined
        ? loadConfig(resolve(process.cwd(), configPath))
        : loadConfigFromDir(process.cwd());
  } catch (err) {
    if (err instanceof ConfigError) fail(`error: ${err.message}`);
    throw err;
  }
  return { ...configToDetectorOptions(config), ...cliOptions };
}

function formatFinding(f: Finding): string {
  const ids =
    f.span_ids.length > 4
      ? `${f.span_ids.slice(0, 4).join(", ")}… (+${f.span_ids.length - 4})`
      : f.span_ids.join(", ");
  return [
    `[${f.severity}] ${f.detector}: ${f.title}`,
    `  ${f.detail}`,
    `  spans: ${ids}`,
  ].join("\n");
}

function printText(result: AnalysisResult, parseErrorCount: number): void {
  const s = result.stats;
  const lines: string[] = [];
  lines.push("graph");
  lines.push(`  spans:        ${s.total_spans}`);
  lines.push(`  roots:        ${s.roots}`);
  lines.push(`  max_depth:    ${s.max_depth}`);
  lines.push(`  orphans:      ${s.orphan_spans}`);
  lines.push(`  duration_ms:  ${s.total_duration_ms}`);
  lines.push(
    `  by_kind:      ${Object.entries(s.by_kind)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  if (parseErrorCount > 0) {
    lines.push(`  parse_errors: ${parseErrorCount}`);
  }
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("findings: none — clean trace");
  } else {
    lines.push(`findings: ${result.findings.length}`);
    for (const f of result.findings) {
      lines.push("");
      lines.push(formatFinding(f));
    }
  }
  if (result.critical_path.length > 0) {
    lines.push("");
    lines.push(`critical_path: ${result.critical_path.join(" → ")}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function main(argv: string[]): void {
  const { command, path, format, options: cliOptions, top, configPath } = parseArgs(argv);

  if (!command || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  if (
    command !== "analyze" &&
    command !== "analyze-many" &&
    command !== "stats"
  ) {
    fail(`error: unknown command "${command}"\n\n${USAGE}`);
  }

  const options = resolveOptions(configPath, cliOptions);
  const wantJson = format === "json";

  if (command === "analyze-many") {
    const dir = path;
    if (!dir) fail("error: analyze-many requires a directory path");
    let batch: TraceBatchResult;
    try {
      batch = analyzeMany(dir, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`error: ${msg}`);
    }
    if (batch.aggregate.traces === 0) {
      fail(`error: no .jsonl traces found in ${dir}`);
    }
    if (wantJson) {
      const payload: AnalyzeManyJson = {
        schema_version: OUTPUT_SCHEMA_VERSION,
        ok: batch.ok,
        command: "analyze-many",
        dir: batch.dir,
        files: batch.files,
        aggregate: batch.aggregate,
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stdout.write(`${formatFindingsTable(batch)}\n`);
    }
    if (!batch.ok) process.exit(1);
    return;
  }

  const file = path;
  if (!file) fail(`error: ${command} requires a path to a .jsonl trace`);

  const abs = resolve(process.cwd(), file);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`error: cannot read ${file}: ${msg}`);
  }

  const { events, errors } = parseJsonl(text);
  if (events.length === 0 && errors.length > 0) {
    if (wantJson) {
      const payload: AnalyzeJson = {
        schema_version: OUTPUT_SCHEMA_VERSION,
        ok: false,
        command: "analyze",
        file,
        parse_errors: errors,
        stats: null,
        findings: [],
        critical_path: [],
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stderr.write(`error: no valid events in ${file}\n`);
      for (const e of errors.slice(0, 10)) {
        process.stderr.write(`  line ${e.line}: ${e.message}\n`);
      }
    }
    process.exit(1);
  }

  const graph = buildGraph(events);

  if (command === "stats") {
    const summary = summarizeStats(graph, options);
    if (wantJson) {
      const payload: StatsJson = {
        schema_version: OUTPUT_SCHEMA_VERSION,
        ok: true,
        command: "stats",
        file,
        parse_errors: errors,
        summary,
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      if (errors.length > 0) {
        process.stderr.write(`warning: ${errors.length} parse error(s)\n`);
      }
      process.stdout.write(`${formatStats(summary, top)}\n`);
    }
    return;
  }

  const result = analyze(graph, options);

  if (wantJson) {
    const payload: AnalyzeJson = {
      schema_version: OUTPUT_SCHEMA_VERSION,
      ok: true,
      command: "analyze",
      file,
      parse_errors: errors,
      stats: result.stats,
      findings: result.findings,
      critical_path: result.critical_path,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  if (errors.length > 0) {
    process.stderr.write(`warning: ${errors.length} parse error(s)\n`);
    for (const e of errors.slice(0, 5)) {
      process.stderr.write(`  line ${e.line}: ${e.message}\n`);
    }
  }
  printText(result, errors.length);
}

main(process.argv.slice(2));

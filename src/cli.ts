#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyze, type DetectorOptions } from "./detectors.js";
import { buildGraph } from "./graph.js";
import { parseJsonl } from "./parse.js";
import type { AnalysisResult, Finding } from "./types.js";

const USAGE = `atm — agent-trace-map

Usage:
  atm analyze <trace.jsonl> [--json] [--stall-ms N] [--loop-threshold N]

Commands:
  analyze     Parse a JSONL trace, build the reasoning graph, run detectors

Options:
  --json              Emit machine-readable JSON instead of text
  --stall-ms N        Stall duration threshold in ms (default 5000)
  --loop-threshold N  Consecutive similar spans that count as a loop (default 3)
  -h, --help          Show this help
`;

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): {
  command: string;
  file?: string;
  json: boolean;
  options: DetectorOptions;
} {
  const options: DetectorOptions = {};
  let json = false;
  let command = "";
  let file: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a === "--json") {
      json = true;
    } else if (a === "--stall-ms") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) fail("error: --stall-ms requires a non-negative number");
      options.stallMs = v;
    } else if (a === "--loop-threshold") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 2) fail("error: --loop-threshold requires an integer >= 2");
      options.loopThreshold = v;
    } else if (!command) {
      command = a;
    } else if (!file) {
      file = a;
    } else {
      fail(`error: unexpected argument "${a}"`);
    }
  }

  return { command, file, json, options };
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
  const { command, file, json, options } = parseArgs(argv);

  if (!command || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  if (command !== "analyze") {
    fail(`error: unknown command "${command}"\n\n${USAGE}`);
  }
  if (!file) fail("error: analyze requires a path to a .jsonl trace");

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
    if (json) {
      process.stdout.write(
        JSON.stringify(
          { ok: false, parse_errors: errors, stats: null, findings: [], critical_path: [] },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stderr.write(`error: no valid events in ${file}\n`);
      for (const e of errors.slice(0, 10)) {
        process.stderr.write(`  line ${e.line}: ${e.message}\n`);
      }
    }
    process.exit(1);
  }

  const graph = buildGraph(events);
  const result = analyze(graph, options);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          parse_errors: errors,
          stats: result.stats,
          findings: result.findings,
          critical_path: result.critical_path,
        },
        null,
        2,
      ) + "\n",
    );
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

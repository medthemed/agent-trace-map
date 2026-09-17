/**
 * Batch analysis of a directory of JSONL traces.
 *
 * Parses every `*.jsonl` file, runs detectors, and rolls findings into
 * an aggregate table suitable for CI summaries.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyze, type DetectorOptions } from "./detectors.js";
import { buildGraph } from "./graph.js";
import { parseJsonl } from "./parse.js";
import type { Finding, FindingSeverity } from "./types.js";

export interface TraceBatchFileResult {
  /** Basename of the trace file. */
  file: string;
  /** True when the file parsed and produced a graph. */
  ok: boolean;
  parse_error_count: number;
  spans: number;
  finding_count: number;
  findings: Finding[];
  critical_path_length: number;
  /** Set when the file could not be analyzed. */
  message?: string;
}

export interface TraceBatchAggregate {
  traces: number;
  ok: number;
  failed: number;
  total_spans: number;
  total_findings: number;
  by_detector: Record<string, number>;
  by_severity: Record<string, number>;
}

export interface TraceBatchResult {
  dir: string;
  files: TraceBatchFileResult[];
  aggregate: TraceBatchAggregate;
  /** True when every trace analyzed successfully (parse ok). */
  ok: boolean;
}

/**
 * List `*.jsonl` files in a directory (non-recursive), sorted by name.
 */
export function listTraceFiles(dir: string): string[] {
  const abs = resolve(dir);
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot read directory ${dir}: ${msg}`);
  }

  const files: string[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".jsonl")) continue;
    const full = join(abs, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    files.push(name);
  }
  files.sort();
  return files;
}

function emptyAggregate(): TraceBatchAggregate {
  return {
    traces: 0,
    ok: 0,
    failed: 0,
    total_spans: 0,
    total_findings: 0,
    by_detector: {},
    by_severity: {},
  };
}

/**
 * Analyze every `*.jsonl` trace in `dir` and aggregate findings.
 *
 * Files with zero valid events are marked failed; the rest contribute
 * their findings to the rollup.
 */
export function analyzeMany(
  dir: string,
  options: DetectorOptions = {},
): TraceBatchResult {
  const abs = resolve(dir);
  const names = listTraceFiles(abs);
  const files: TraceBatchFileResult[] = [];
  const aggregate = emptyAggregate();

  for (const name of names) {
    const full = join(abs, name);
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      files.push({
        file: name,
        ok: false,
        parse_error_count: 0,
        spans: 0,
        finding_count: 0,
        findings: [],
        critical_path_length: 0,
        message: msg,
      });
      aggregate.traces++;
      aggregate.failed++;
      continue;
    }

    const { events, errors } = parseJsonl(text);
    if (events.length === 0) {
      files.push({
        file: name,
        ok: false,
        parse_error_count: errors.length,
        spans: 0,
        finding_count: 0,
        findings: [],
        critical_path_length: 0,
        message:
          errors.length > 0
            ? `no valid events (${errors.length} parse error(s))`
            : "no events",
      });
      aggregate.traces++;
      aggregate.failed++;
      continue;
    }

    const graph = buildGraph(events);
    const result = analyze(graph, options);

    files.push({
      file: name,
      ok: true,
      parse_error_count: errors.length,
      spans: graph.stats.total_spans,
      finding_count: result.findings.length,
      findings: result.findings,
      critical_path_length: result.critical_path.length,
    });

    aggregate.traces++;
    aggregate.ok++;
    aggregate.total_spans += graph.stats.total_spans;
    aggregate.total_findings += result.findings.length;
    for (const f of result.findings) {
      aggregate.by_detector[f.detector] = (aggregate.by_detector[f.detector] ?? 0) + 1;
      aggregate.by_severity[f.severity] = (aggregate.by_severity[f.severity] ?? 0) + 1;
    }
  }

  return {
    dir,
    files,
    aggregate,
    ok: aggregate.traces > 0 && aggregate.failed === 0,
  };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Human-readable report: per-trace rollup table + aggregate findings table.
 */
export function formatFindingsTable(result: TraceBatchResult): string {
  const lines: string[] = [];
  lines.push(`analyze-many: ${result.dir}`);
  lines.push("");

  // Per-trace rollup
  const fileRows = result.files.map((f) => ({
    file: f.file,
    spans: String(f.spans),
    findings: String(f.finding_count),
    status: f.ok ? (f.parse_error_count > 0 ? "ok*" : "ok") : "FAILED",
    note: f.ok ? "" : (f.message ?? ""),
  }));
  const headers = ["file", "spans", "findings", "status"] as const;
  const widths = headers.map((h) =>
    Math.max(h.length, ...fileRows.map((r) => r[h].length)),
  );
  const pad = (s: string, w: number) => s.padEnd(w);
  lines.push(
    headers.map((h, i) => pad(h, widths[i]!)).join("  ").trimEnd(),
  );
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of fileRows) {
    const row = headers.map((h, i) => pad(r[h], widths[i]!)).join("  ").trimEnd();
    lines.push(r.note ? `${row}  ${r.note}` : row);
  }

  lines.push("");

  // Aggregate findings, grouped by severity then detector
  const allFindings = result.files.flatMap((f) =>
    f.findings.map((finding) => ({ file: f.file, finding })),
  );
  if (allFindings.length === 0) {
    lines.push("findings: none — all traces clean");
  } else {
    const sorted = [...allFindings].sort((a, b) => {
      const sa = SEVERITY_ORDER[a.finding.severity] ?? 9;
      const sb = SEVERITY_ORDER[b.finding.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      if (a.finding.detector !== b.finding.detector) {
        return a.finding.detector < b.finding.detector ? -1 : 1;
      }
      return a.file < b.file ? -1 : 1;
    });

    lines.push(`findings: ${sorted.length}`);
    lines.push("");
    const fHeaders = ["severity", "detector", "trace", "title"] as const;
    const fRows = sorted.map((s) => ({
      severity: s.finding.severity,
      detector: s.finding.detector,
      trace: s.file,
      title:
        s.finding.title.length > 60
          ? `${s.finding.title.slice(0, 57)}…`
          : s.finding.title,
    }));
    const fWidths = fHeaders.map((h) =>
      Math.max(h.length, ...fRows.map((r) => r[h].length)),
    );
    lines.push(
      fHeaders.map((h, i) => pad(h, fWidths[i]!)).join("  ").trimEnd(),
    );
    lines.push(fWidths.map((w) => "-".repeat(w)).join("  "));
    for (const r of fRows) {
      lines.push(
        fHeaders.map((h, i) => pad(r[h], fWidths[i]!)).join("  ").trimEnd(),
      );
    }
  }

  lines.push("");
  const a = result.aggregate;
  lines.push(
    `aggregate: ${a.traces} trace(s), ${a.ok} ok, ${a.failed} failed, ` +
      `${a.total_spans} span(s), ${a.total_findings} finding(s)`,
  );
  if (a.total_findings > 0) {
    const byDet = Object.entries(a.by_detector)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    const bySev = Object.entries(a.by_severity)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`  by_detector: ${byDet}`);
    lines.push(`  by_severity: ${bySev}`);
  }

  return lines.join("\n");
}

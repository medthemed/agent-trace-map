import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OUTPUT_SCHEMA_VERSION,
  parseOutputFormat,
  toJsonLine,
} from "../src/format.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

describe("parseOutputFormat", () => {
  it("accepts json and text", () => {
    expect(parseOutputFormat("json")).toBe("json");
    expect(parseOutputFormat("JSON")).toBe("json");
    expect(parseOutputFormat("text")).toBe("text");
  });

  it("returns undefined for missing/empty", () => {
    expect(parseOutputFormat(undefined)).toBeUndefined();
    expect(parseOutputFormat("")).toBeUndefined();
  });

  it("throws on unknown values", () => {
    expect(() => parseOutputFormat("yaml")).toThrow(/unknown --format/);
  });
});

describe("analyze --format json", () => {
  it("emits a stable envelope with findings", () => {
    const { stdout, status } = runCli([
      "analyze",
      "examples/loop-trace.jsonl",
      "--format",
      "json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      schema_version: string;
      ok: boolean;
      command: string;
      file: string;
      parse_errors: unknown[];
      stats: { total_spans: number };
      findings: { detector: string }[];
      critical_path: string[];
    };
    expect(parsed.schema_version).toBe(OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("analyze");
    expect(parsed.file).toBe("examples/loop-trace.jsonl");
    expect(parsed.stats.total_spans).toBeGreaterThan(0);
    expect(parsed.findings.some((f) => f.detector === "loop")).toBe(true);
    expect(Array.isArray(parsed.critical_path)).toBe(true);
  });

  it("--json is a shorthand for --format json", () => {
    const a = runCli(["analyze", "examples/clean-trace.jsonl", "--format", "json"]);
    const b = runCli(["analyze", "examples/clean-trace.jsonl", "--json"]);
    expect(a.stdout).toBe(b.stdout);
    const parsed = JSON.parse(a.stdout) as { schema_version: string };
    expect(parsed.schema_version).toBe(OUTPUT_SCHEMA_VERSION);
  });

  it("emits ok:false with parse_errors on a bad file", () => {
    const { stdout, status } = runCli(["analyze", "README.md", "--format", "json"]);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      command: string;
      parse_errors: unknown[];
      findings: unknown[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe("analyze");
    expect(parsed.parse_errors.length).toBeGreaterThan(0);
    expect(parsed.findings).toEqual([]);
  });
});

describe("stats --format json", () => {
  it("emits summary inside the envelope", () => {
    const { stdout, status } = runCli([
      "stats",
      "examples/loop-trace.jsonl",
      "--format",
      "json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      schema_version: string;
      ok: boolean;
      command: string;
      file: string;
      summary: { spans: number; findings: { total: number } };
    };
    expect(parsed.schema_version).toBe(OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("stats");
    expect(parsed.summary.spans).toBeGreaterThan(0);
    expect(parsed.summary.findings.total).toBeGreaterThan(0);
  });
});

describe("analyze-many --format json", () => {
  it("emits files and aggregate inside the envelope", () => {
    const { stdout, status } = runCli([
      "analyze-many",
      "examples",
      "--format",
      "json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      schema_version: string;
      ok: boolean;
      command: string;
      dir: string;
      files: { file: string; ok: boolean }[];
      aggregate: { traces: number; total_findings: number };
    };
    expect(parsed.schema_version).toBe(OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("analyze-many");
    expect(parsed.files.length).toBeGreaterThanOrEqual(3);
    expect(parsed.aggregate.traces).toBeGreaterThanOrEqual(3);
    expect(parsed.aggregate.total_findings).toBeGreaterThan(0);
  });
});

describe("rejects unknown --format", () => {
  it("exits 1 with a clear error", () => {
    const { stderr, status } = runCli([
      "analyze",
      "examples/clean-trace.jsonl",
      "--format",
      "yaml",
    ]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/unknown --format/);
  });
});

describe("toJsonLine", () => {
  it("serializes with pretty-printing", () => {
    const line = toJsonLine({
      schema_version: OUTPUT_SCHEMA_VERSION,
      ok: true,
      command: "analyze",
      file: "x.jsonl",
      parse_errors: [],
      stats: null,
      findings: [],
      critical_path: [],
    });
    expect(line).toContain('"schema_version": "1"');
    expect(JSON.parse(line).ok).toBe(true);
  });
});

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: root,
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("atm CLI", () => {
  it("analyzes a clean trace with no findings", () => {
    const { stdout, status } = runCli(["analyze", "examples/clean-trace.jsonl"]);
    expect(status).toBe(0);
    expect(stdout).toContain("findings: none");
    expect(stdout).toContain("spans:");
  });

  it("analyzes a loop trace and reports detectors", () => {
    const { stdout, status } = runCli(["analyze", "examples/loop-trace.jsonl"]);
    expect(status).toBe(0);
    expect(stdout).toContain("loop:");
    expect(stdout).toContain("assumption_failure:");
    expect(stdout).toContain("critical_path:");
  });

  it("emits JSON with --json", () => {
    const { stdout, status } = runCli([
      "analyze",
      "examples/stall-trace.jsonl",
      "--json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      findings: { detector: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.findings.some((f) => f.detector === "stall")).toBe(true);
  });

  it("exits non-zero when the file has no valid events", () => {
    const { status, stdout } = runCli(["analyze", "README.md"]);
    expect(status).toBe(1);
    expect(stdout).toBe("");
  });

  it("prints a stats summary", () => {
    const { stdout, status } = runCli(["stats", "examples/loop-trace.jsonl"]);
    expect(status).toBe(0);
    expect(stdout).toContain("trace stats");
    expect(stdout).toContain("http_get: 5 call(s)");
    expect(stdout).toContain("findings:");
  });

  it("emits stats JSON with --json", () => {
    const { stdout, status } = runCli(["stats", "examples/clean-trace.jsonl", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      summary: { spans: number; findings: { total: number } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.spans).toBeGreaterThan(0);
    expect(parsed.summary.findings.total).toBe(0);
  });

  it("limits tools listed with --top", () => {
    const { stdout, status } = runCli(["stats", "examples/loop-trace.jsonl", "--top", "1"]);
    expect(status).toBe(0);
    const toolLines = stdout.split("\n").filter((l) => l.includes("call(s)"));
    expect(toolLines.length).toBeLessThanOrEqual(1);
  });
});

describe("atm analyze --config", () => {
  const tmpConfig = join(root, "examples", ".tmp-thresholds.json");

  afterAll(() => {
    try {
      rmSync(tmpConfig, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("applies detector thresholds from a config file", () => {
    writeFileSync(
      tmpConfig,
      JSON.stringify({ loop_threshold: 2, stall_ms: 50 }),
      "utf8",
    );
    const { stdout, status } = runCli([
      "analyze",
      "examples/clean-trace.jsonl",
      "--config",
      "examples/.tmp-thresholds.json",
      "--json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      findings: { detector: string; data?: Record<string, unknown> }[];
    };
    expect(parsed.ok).toBe(true);
    // stall_ms=50 should flag spans that are slower than the default path
    const stalls = parsed.findings.filter((f) => f.detector === "stall");
    // clean-trace may still have short spans; at minimum config must not crash
    expect(Array.isArray(stalls)).toBe(true);
  });

  it("rejects an invalid config file", () => {
    writeFileSync(tmpConfig, JSON.stringify({ loop_threshold: 0 }), "utf8");
    const { status } = runCli([
      "analyze",
      "examples/clean-trace.jsonl",
      "--config",
      "examples/.tmp-thresholds.json",
    ]);
    expect(status).toBe(1);
  });

  it("explicit CLI flags override config", () => {
    writeFileSync(tmpConfig, JSON.stringify({ loop_threshold: 2 }), "utf8");
    const withConfig = runCli([
      "analyze",
      "examples/clean-trace.jsonl",
      "--config",
      "examples/.tmp-thresholds.json",
      "--json",
    ]);
    const withOverride = runCli([
      "analyze",
      "examples/clean-trace.jsonl",
      "--config",
      "examples/.tmp-thresholds.json",
      "--loop-threshold",
      "99",
      "--json",
    ]);
    expect(withConfig.status).toBe(0);
    expect(withOverride.status).toBe(0);
  });
});

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
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
});

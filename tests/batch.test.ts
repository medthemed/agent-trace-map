import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeMany,
  formatFindingsTable,
  listTraceFiles,
} from "../src/batch.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(root, "examples");

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "atm-batch-"));
  for (const name of ["clean-trace.jsonl", "loop-trace.jsonl", "stall-trace.jsonl"]) {
    writeFileSync(
      join(dir, name),
      readFileSync(join(examples, name), "utf8"),
      "utf8",
    );
  }
  writeFileSync(join(dir, "broken.jsonl"), "not jsonl at all\n", "utf8");
  writeFileSync(join(dir, "notes.txt"), "ignore me", "utf8");
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested", "skip.jsonl"), "{}\n", "utf8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listTraceFiles", () => {
  it("lists .jsonl files sorted, non-recursive", () => {
    const files = listTraceFiles(dir);
    expect(files).toEqual([
      "broken.jsonl",
      "clean-trace.jsonl",
      "loop-trace.jsonl",
      "stall-trace.jsonl",
    ]);
  });

  it("throws for a missing directory", () => {
    expect(() => listTraceFiles(join(dir, "nope"))).toThrow(/cannot read directory/);
  });
});

describe("analyzeMany", () => {
  it("aggregates findings across traces", () => {
    const result = analyzeMany(dir);
    expect(result.aggregate.traces).toBe(4);
    expect(result.aggregate.ok).toBe(3);
    expect(result.aggregate.failed).toBe(1);
    expect(result.ok).toBe(false);

    const loop = result.files.find((f) => f.file === "loop-trace.jsonl");
    expect(loop?.ok).toBe(true);
    expect(loop?.finding_count).toBeGreaterThan(0);
    expect(loop?.findings.some((f) => f.detector === "loop")).toBe(true);

    const broken = result.files.find((f) => f.file === "broken.jsonl");
    expect(broken?.ok).toBe(false);
    expect(broken?.message).toMatch(/no valid events|no events/);

    expect(result.aggregate.total_findings).toBeGreaterThan(0);
    expect(Object.keys(result.aggregate.by_detector).length).toBeGreaterThan(0);
  });

  it("returns ok when every trace analyzes", () => {
    const goodDir = mkdtempSync(join(tmpdir(), "atm-batch-ok-"));
    try {
      writeFileSync(
        join(goodDir, "only.jsonl"),
        readFileSync(join(examples, "clean-trace.jsonl"), "utf8"),
        "utf8",
      );
      const result = analyzeMany(goodDir);
      expect(result.ok).toBe(true);
      expect(result.aggregate.ok).toBe(1);
      expect(result.aggregate.total_findings).toBe(0);
    } finally {
      rmSync(goodDir, { recursive: true, force: true });
    }
  });
});

describe("formatFindingsTable", () => {
  it("renders a per-trace table and aggregate line", () => {
    const result = analyzeMany(dir);
    const text = formatFindingsTable(result);
    expect(text).toContain("analyze-many:");
    expect(text).toContain("loop-trace.jsonl");
    expect(text).toContain("clean-trace.jsonl");
    expect(text).toContain("FAILED");
    expect(text).toContain("findings:");
    expect(text).toContain("aggregate:");
    expect(text).toContain("by_detector:");
  });

  it("says clean when no findings", () => {
    const goodDir = mkdtempSync(join(tmpdir(), "atm-batch-clean-"));
    try {
      writeFileSync(
        join(goodDir, "only.jsonl"),
        readFileSync(join(examples, "clean-trace.jsonl"), "utf8"),
        "utf8",
      );
      const text = formatFindingsTable(analyzeMany(goodDir));
      expect(text).toContain("findings: none");
    } finally {
      rmSync(goodDir, { recursive: true, force: true });
    }
  });
});

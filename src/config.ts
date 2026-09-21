/**
 * Optional project config: `atm.config.json`.
 *
 * Holds detector thresholds so teams can pin loop similarity and stall
 * sensitivity without re-typing CLI flags.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorOptions } from "./detectors.js";

export const CONFIG_FILENAME = "atm.config.json";

export interface AtmConfig {
  /** Consecutive similar spans that count as a loop. */
  loop_threshold: number;
  /** Minimum duration (ms) for a span to count as a stall. */
  stall_ms: number;
  /** Minimum idle gap (ms) between siblings. */
  stall_gap_ms: number;
  /** Minimum count of failed tools sharing a root cause. */
  assumption_failure_min: number;
}

export const DEFAULT_ATM_CONFIG: AtmConfig = Object.freeze({
  loop_threshold: 3,
  stall_ms: 5000,
  stall_gap_ms: 3000,
  assumption_failure_min: 2,
});

export class ConfigError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "ConfigError";
    this.path = path;
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requirePositiveInt(value: unknown, field: string, path?: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConfigError(`${field} must be an integer >= 1`, path);
  }
  return value;
}

function requireNonNegativeNumber(
  value: unknown,
  field: string,
  path?: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${field} must be a non-negative number`, path);
  }
  return value;
}

/**
 * Parse a raw config object. Missing keys fall back to defaults.
 */
export function parseConfig(raw: unknown, sourcePath?: string): AtmConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("config must be a JSON object", sourcePath);
  }

  const loop_threshold =
    raw.loop_threshold === undefined
      ? DEFAULT_ATM_CONFIG.loop_threshold
      : requirePositiveInt(raw.loop_threshold, "loop_threshold", sourcePath);

  const stall_ms =
    raw.stall_ms === undefined
      ? DEFAULT_ATM_CONFIG.stall_ms
      : requireNonNegativeNumber(raw.stall_ms, "stall_ms", sourcePath);

  const stall_gap_ms =
    raw.stall_gap_ms === undefined
      ? DEFAULT_ATM_CONFIG.stall_gap_ms
      : requireNonNegativeNumber(raw.stall_gap_ms, "stall_gap_ms", sourcePath);

  const assumption_failure_min =
    raw.assumption_failure_min === undefined
      ? DEFAULT_ATM_CONFIG.assumption_failure_min
      : requirePositiveInt(
          raw.assumption_failure_min,
          "assumption_failure_min",
          sourcePath,
        );

  return {
    loop_threshold,
    stall_ms,
    stall_gap_ms,
    assumption_failure_min,
  };
}

/**
 * Load config from a file path. Missing file → defaults.
 */
export function loadConfig(path: string): AtmConfig {
  const abs = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...DEFAULT_ATM_CONFIG };
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`cannot read config: ${msg}`, abs);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`config is not valid JSON: ${msg}`, abs);
  }
  return parseConfig(parsed, abs);
}

/** Load `atm.config.json` from a directory. Absent → defaults. */
export function loadConfigFromDir(dir: string): AtmConfig {
  return loadConfig(resolve(dir, CONFIG_FILENAME));
}

/** Convert config into DetectorOptions for analyze/detectors. */
export function configToDetectorOptions(config: AtmConfig): DetectorOptions {
  return {
    loopThreshold: config.loop_threshold,
    stallMs: config.stall_ms,
    stallGapMs: config.stall_gap_ms,
    assumptionFailureMin: config.assumption_failure_min,
  };
}

/** Pretty JSON for scaffolding / docs. */
export function configToJson(config: AtmConfig): string {
  return JSON.stringify(config, null, 2);
}

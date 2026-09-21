import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_ATM_CONFIG,
  configToDetectorOptions,
  configToJson,
  parseConfig,
} from "../src/config.js";

describe("parseConfig", () => {
  it("returns defaults for an empty object", () => {
    const cfg = parseConfig({});
    expect(cfg).toEqual(DEFAULT_ATM_CONFIG);
  });

  it("accepts custom thresholds", () => {
    const cfg = parseConfig({
      loop_threshold: 2,
      stall_ms: 1000,
      stall_gap_ms: 500,
      assumption_failure_min: 3,
    });
    expect(cfg.loop_threshold).toBe(2);
    expect(cfg.stall_ms).toBe(1000);
    expect(cfg.stall_gap_ms).toBe(500);
    expect(cfg.assumption_failure_min).toBe(3);
  });

  it("rejects non-object", () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
    expect(() => parseConfig("x")).toThrow(ConfigError);
  });

  it("rejects invalid loop_threshold", () => {
    expect(() => parseConfig({ loop_threshold: 0 })).toThrow(/loop_threshold/);
    expect(() => parseConfig({ loop_threshold: 1.5 })).toThrow(/loop_threshold/);
    expect(() => parseConfig({ loop_threshold: "3" })).toThrow(/loop_threshold/);
  });

  it("rejects invalid stall_ms", () => {
    expect(() => parseConfig({ stall_ms: -1 })).toThrow(/stall_ms/);
    expect(() => parseConfig({ stall_ms: "5s" })).toThrow(/stall_ms/);
  });

  it("rejects invalid stall_gap_ms", () => {
    expect(() => parseConfig({ stall_gap_ms: -10 })).toThrow(/stall_gap_ms/);
  });

  it("rejects invalid assumption_failure_min", () => {
    expect(() => parseConfig({ assumption_failure_min: 0 })).toThrow(
      /assumption_failure_min/,
    );
  });
});

describe("configToDetectorOptions", () => {
  it("maps config fields onto DetectorOptions", () => {
    const opts = configToDetectorOptions({
      loop_threshold: 4,
      stall_ms: 2500,
      stall_gap_ms: 1000,
      assumption_failure_min: 5,
    });
    expect(opts).toEqual({
      loopThreshold: 4,
      stallMs: 2500,
      stallGapMs: 1000,
      assumptionFailureMin: 5,
    });
  });
});

describe("configToJson", () => {
  it("round-trips through parseConfig", () => {
    const json = configToJson(DEFAULT_ATM_CONFIG);
    const parsed = parseConfig(JSON.parse(json));
    expect(parsed).toEqual(DEFAULT_ATM_CONFIG);
  });
});

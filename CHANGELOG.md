# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-29

### Added

- `--format json` for `analyze`, `analyze-many`, and `stats`
- Stable JSON envelope: `{ schema_version: "1", ok, command, ... }`
- Library exports: `OUTPUT_SCHEMA_VERSION`, `parseOutputFormat`, `toJsonLine`
- README documents the pipe contract and per-command payload fields

### Changed

- `--json` is now a shorthand for `--format json`

## [0.4.0] - 2026-09-26

### Added

- `atm analyze-many <dir>` — analyze every `*.jsonl` trace in a directory
- Per-trace rollup table and aggregate findings table (by detector / severity)
- Library exports: `analyzeMany`, `listTraceFiles`, `formatFindingsTable`

### Changed

- README documents batch analysis and the library entry points

## [0.3.0] - 2026-09-23

### Added

- Optional `atm.config.json` for detector thresholds (`loop_threshold`, `stall_ms`, `stall_gap_ms`, `assumption_failure_min`)
- `atm analyze` / `atm stats` accept `--config <path>` and auto-load from cwd
- Library exports: `parseConfig`, `loadConfig`, `loadConfigFromDir`, `configToDetectorOptions`, `ConfigError`

### Changed

- Explicit CLI flags override config-file values

## [0.2.0] - 2026-09-20

### Added

- Typed `AnalysisError` / `TraceParseError` (instanceof-friendly)
- `assertParseable` throws when a trace has zero valid events
- Frozen public export catalog: `PUBLIC_API`, `PUBLIC_API_NAMES`
- Integration suite over every `examples/*.jsonl` fixture

### Changed

- README documents typed errors and the frozen export surface

## [0.1.1] - 2026-09-17

### Added

- `atm stats <trace.jsonl>` — compact operational summary
  (span counts, duration min/avg/p95/max, tool usage, finding rollup)
- `--top N` option to limit tools listed in stats output
- Library exports: `summarizeStats`, `formatStats`
- README sample-trace walkthrough for `examples/loop-trace.jsonl`
- README CI badge and stats usage

## [0.1.0] - 2026-01-15

### Added

- Trace event schema (`plan|tool|reflect|fail|commit`) with span/parent linkage
- JSONL parser with per-line error collection
- Reasoning graph builder (forest with orphan and cycle handling)
- Detectors: loop, stall (duration + idle gap), assumption failure, critical path
- `atm analyze` CLI with text and `--json` output
- Example traces under `examples/`
- Vitest suite covering parse errors, loop/stall detection, and clean traces

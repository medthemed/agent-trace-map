# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-15

### Added

- Trace event schema (`plan|tool|reflect|fail|commit`) with span/parent linkage
- JSONL parser with per-line error collection
- Reasoning graph builder (forest with orphan and cycle handling)
- Detectors: loop, stall (duration + idle gap), assumption failure, critical path
- `atm analyze` CLI with text and `--json` output
- Example traces under `examples/`
- Vitest suite covering parse errors, loop/stall detection, and clean traces

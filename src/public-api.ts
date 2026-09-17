/**
 * Public API surface for agent-trace-map.
 *
 * Frozen catalog of runtime exports so accidental mutation of the
 * export table fails fast.
 */

import { TRACE_KINDS, isTraceKind } from "./types.js";
import { coerceEvent, parseJsonl } from "./parse.js";
import { buildGraph, flattenGraph, pathToSpan } from "./graph.js";
import {
  analyze,
  criticalPathToFailure,
  detectAssumptionFailures,
  detectLoops,
  detectStalls,
  similarityKey,
} from "./detectors.js";
import { formatStats, summarizeStats } from "./stats.js";
import {
  AnalysisError,
  TraceParseError,
  assertParseable,
  isAnalysisError,
  isTraceParseError,
} from "./errors.js";
import {
  CONFIG_FILENAME,
  ConfigError,
  DEFAULT_ATM_CONFIG,
  configToDetectorOptions,
  configToJson,
  loadConfig,
  loadConfigFromDir,
  parseConfig,
} from "./config.js";
import {
  analyzeMany,
  formatFindingsTable,
  listTraceFiles,
} from "./batch.js";

export const PUBLIC_API = Object.freeze({
  TRACE_KINDS,
  isTraceKind,
  coerceEvent,
  parseJsonl,
  buildGraph,
  flattenGraph,
  pathToSpan,
  analyze,
  criticalPathToFailure,
  detectAssumptionFailures,
  detectLoops,
  detectStalls,
  similarityKey,
  formatStats,
  summarizeStats,
  AnalysisError,
  TraceParseError,
  assertParseable,
  isAnalysisError,
  isTraceParseError,
  CONFIG_FILENAME,
  ConfigError,
  DEFAULT_ATM_CONFIG,
  configToDetectorOptions,
  configToJson,
  loadConfig,
  loadConfigFromDir,
  parseConfig,
  analyzeMany,
  formatFindingsTable,
  listTraceFiles,
});

export const PUBLIC_API_NAMES: readonly string[] = Object.freeze(
  Object.keys(PUBLIC_API).sort(),
);

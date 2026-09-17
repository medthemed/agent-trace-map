import type {
  GraphNode,
  GraphStats,
  ReasoningGraph,
  TraceEvent,
  TraceKind,
} from "./types.js";
import { TRACE_KINDS } from "./types.js";

function emptyByKind(): Record<TraceKind, number> {
  const out = {} as Record<TraceKind, number>;
  for (const k of TRACE_KINDS) out[k] = 0;
  return out;
}

/**
 * Build a reasoning graph from a list of trace events.
 *
 * - Nodes are keyed by span_id (last write wins on duplicates).
 * - Events whose parent_span_id is missing from the set become extra roots
 *   and are counted as orphans.
 * - Cycle edges (parent already in the ancestor chain) are detached to roots
 *   so the structure stays a forest.
 */
export function buildGraph(events: TraceEvent[]): ReasoningGraph {
  const nodes = new Map<string, GraphNode>();
  for (const event of events) {
    if (nodes.has(event.span_id)) continue; // keep first occurrence
    nodes.set(event.span_id, {
      event,
      children: [],
      depth: 0,
    });
  }

  const roots: GraphNode[] = [];
  let orphanSpans = 0;

  for (const node of nodes.values()) {
    const parentRef = node.event.parent_span_id;
    if (parentRef === undefined || parentRef === null || parentRef === "") {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(parentRef);
    if (!parent) {
      roots.push(node);
      orphanSpans++;
      continue;
    }
    // cycle guard: if parent is a descendant of node, detach
    if (isAncestor(node, parent)) {
      roots.push(node);
      orphanSpans++;
      continue;
    }
    parent.children.push(node);
  }

  // sort children by ts then span_id for stable output
  const sortChildren = (n: GraphNode): void => {
    n.children.sort((a, b) => {
      const ta = a.event.ts ?? "";
      const tb = b.event.ts ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.event.span_id < b.event.span_id ? -1 : 1;
    });
    for (const c of n.children) sortChildren(c);
  };
  for (const r of roots) sortChildren(r);
  roots.sort((a, b) => {
    const ta = a.event.ts ?? "";
    const tb = b.event.ts ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.event.span_id < b.event.span_id ? -1 : 1;
  });

  // depths
  const assignDepth = (n: GraphNode, depth: number): void => {
    n.depth = depth;
    for (const c of n.children) assignDepth(c, depth + 1);
  };
  for (const r of roots) assignDepth(r, 0);

  const by_kind = emptyByKind();
  let total_duration_ms = 0;
  let max_depth = 0;
  for (const node of nodes.values()) {
    by_kind[node.event.kind]++;
    total_duration_ms += node.event.duration_ms;
    if (node.depth > max_depth) max_depth = node.depth;
  }

  const stats: GraphStats = {
    total_spans: nodes.size,
    roots: roots.length,
    max_depth,
    by_kind,
    total_duration_ms,
    orphan_spans: orphanSpans,
  };

  return { roots, nodes, stats };
}

function isAncestor(possibleAncestor: GraphNode, node: GraphNode): boolean {
  // walk up from node via parent map would need parent pointers; instead
  // DFS from possibleAncestor looking for node.
  const stack = [...possibleAncestor.children];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === node) return true;
    stack.push(...cur.children);
  }
  return false;
}

/** Flatten the forest in pre-order. */
export function flattenGraph(graph: ReasoningGraph): GraphNode[] {
  const out: GraphNode[] = [];
  const walk = (n: GraphNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of graph.roots) walk(r);
  return out;
}

/**
 * Collect the ancestor chain (root → … → node) for a span id.
 * Returns [] if the span is unknown.
 */
export function pathToSpan(graph: ReasoningGraph, spanId: string): GraphNode[] {
  const target = graph.nodes.get(spanId);
  if (!target) return [];
  // build parent index
  const parentOf = new Map<string, GraphNode>();
  for (const node of graph.nodes.values()) {
    for (const c of node.children) {
      parentOf.set(c.event.span_id, node);
    }
  }
  const chain: GraphNode[] = [target];
  const seen = new Set<string>([target.event.span_id]);
  let cur: GraphNode = target;
  for (;;) {
    const parent = parentOf.get(cur.event.span_id);
    if (!parent || seen.has(parent.event.span_id)) break;
    seen.add(parent.event.span_id);
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

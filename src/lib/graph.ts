/**
 * Pure directed-graph helpers used by the curriculum seeder, the learning-plan
 * builder and the curriculum validation console.
 *
 * Kept free of database and Neo4j dependencies so the prerequisite invariants
 * are unit-testable without any infrastructure.
 */

export interface Edge {
  /** The dependent node. */
  from: string;
  /** The node `from` depends on. */
  to: string;
}

/**
 * Depth-first cycle detection returning the offending path, not just a boolean.
 * A seeder that reports "there is a cycle" without saying where is unusable on
 * a 50-edge graph, and the failure it prevents (R10) is silent corruption of
 * every learning plan.
 *
 * @returns the cycle as a node path (first node repeated at the end), or null.
 */
export function findCycle(nodes: readonly string[], edges: readonly Edge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of adjacency.keys()) colour.set(node, WHITE);

  const stack: string[] = [];

  function visit(node: string): string[] | null {
    colour.set(node, GREY);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        // Grey means `next` is on the current DFS path — slice the cycle out of it.
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (state === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }

    stack.pop();
    colour.set(node, BLACK);
    return null;
  }

  for (const node of adjacency.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Kahn's algorithm. Returns null when the graph is cyclic — callers that need
 * to explain the failure should call `findCycle` for the path.
 */
export function topologicalSort(
  nodes: readonly string[],
  edges: readonly Edge[],
): string[] | null {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node, 0);
    adjacency.set(node, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Sorted seed queue keeps the output deterministic across runs.
  const queue = [...nodes].filter((n) => (indegree.get(n) ?? 0) === 0).sort();
  const order: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    order.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  return order.length === nodes.length ? order : null;
}

/**
 * Every node reachable from `start` by following edges, excluding `start`.
 * With prerequisite edges oriented dependent → prerequisite, this is the
 * transitive prerequisite closure used by the learning plan (§8.5 step 6).
 */
export function reachableFrom(start: string, edges: readonly Edge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }

  const seen = new Set<string>();
  const queue = [...(adjacency.get(start) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  seen.delete(start);
  return seen;
}

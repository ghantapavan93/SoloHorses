import dagreModule from '@dagrejs/dagre';

/**
 * The four calls this file makes into dagre, typed here: `tsc` resolves the package's own
 * types, but the linter's project does not, and an untyped import would fail its safety rules.
 */
interface DagreGraph {
  setGraph(options: { rankdir: string; nodesep: number; ranksep: number; marginx: number; marginy: number }): void;
  setDefaultEdgeLabel(fn: () => Record<string, never>): void;
  setNode(id: string, options: { width: number; height: number }): void;
  setEdge(from: string, to: string): void;
  node(id: string): { x: number; y: number };
  graph(): { width?: number; height?: number };
}
interface DagreModule {
  graphlib: { Graph: new () => DagreGraph };
  layout(graph: DagreGraph): void;
}
const dagre = dagreModule as unknown as DagreModule;

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A small directed graph laid out once, left to right, on the API: the page draws it without
 * a flash and a phone reads the same nodes as a list in rank order. Positions are top-left.
 */
export function layoutDag(
  nodes: { id: string; w: number; h: number }[],
  edges: { from: string; to: string }[],
  options: { nodesep?: number; ranksep?: number } = {},
): { positions: Map<string, Placed>; width: number; height: number } {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'LR',
    nodesep: options.nodesep ?? 14,
    ranksep: options.ranksep ?? 54,
    marginx: 8,
    marginy: 8,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: node.w, height: node.h });
  for (const edge of edges) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);
  const positions = new Map<string, Placed>();
  for (const node of nodes) {
    const p = graph.node(node.id);
    positions.set(node.id, { x: Math.round(p.x - node.w / 2), y: Math.round(p.y - node.h / 2), w: node.w, h: node.h });
  }
  const meta = graph.graph();
  return { positions, width: Math.ceil(meta.width ?? 0) + 16, height: Math.ceil(meta.height ?? 0) + 16 };
}

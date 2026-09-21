import { layoutDag } from '../../../platform/layout/dag';

/**
 * Why this one: a signal's causal map. The record it is about and the records it cites, the
 * facts as the tables hold them, the rule that read them, the thing that is missing or held —
 * the block — and the person who decides. Nothing here is generated: the facts are the
 * explanation's system state, the rule is the detector's code, the block is the signal itself,
 * the decision is its owner and next step. The layout is computed here, once, so the page
 * draws it without a flash and a phone can read it as a list in the same rank order.
 */
export interface MapNode {
  id: string;
  kind: 'record' | 'fact' | 'rule' | 'gap' | 'decision';
  label: string;
  sublabel?: string;
  /** A record code the node stands for, so it can be a link. */
  recordId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
}

export interface SignalMap {
  nodes: MapNode[];
  edges: MapEdge[];
  blockId: string;
  width: number;
  height: number;
}

export interface SignalMapInput {
  id: string;
  /** The kind's short label: "Registration papers held". */
  label: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  systemState: { key: string; value: string }[];
  next: string;
  owner: string;
}

const NODE_W = 196;
const NODE_H = 46;
const MAX_FACTS = 6;
const MAX_EVIDENCE = 4;

export function signalMap(input: SignalMapInput): SignalMap {
  const detail = input.detail ?? {};
  const nodes: Omit<MapNode, 'x' | 'y' | 'w' | 'h'>[] = [];
  const edges: MapEdge[] = [];
  const link = (from: string, to: string) => edges.push({ id: `${from}->${to}`, from, to });

  const rootId = input.entityId ?? input.id;
  nodes.push({
    id: `record:${rootId}`,
    kind: 'record',
    label: rootId,
    sublabel: 'the record',
    recordId: input.entityId ?? undefined,
  });

  // The records the detector cited, beside the one the signal is about: they feed the rule directly.
  const evidence = (Array.isArray(detail['evidenceIds']) ? (detail['evidenceIds'] as unknown[]) : [])
    .filter((v): v is string => typeof v === 'string' && v !== input.entityId)
    .slice(0, MAX_EVIDENCE);
  for (const id of evidence)
    nodes.push({ id: `record:${id}`, kind: 'record', label: id, sublabel: 'cited', recordId: id });

  const ruleValue =
    input.systemState.find((s) => s.key === 'rule')?.value ??
    (typeof detail['policy'] === 'string'
      ? detail['policy']
      : typeof detail['code'] === 'string'
        ? detail['code']
        : null);
  const facts = input.systemState.filter((s) => s.key !== 'rule').slice(0, MAX_FACTS);
  for (const fact of facts) nodes.push({ id: `fact:${fact.key}`, kind: 'fact', label: fact.value, sublabel: fact.key });

  const ruleId = 'rule';
  nodes.push({ id: ruleId, kind: 'rule', label: ruleValue ?? 'the detector', sublabel: 'the rule that read them' });
  const blockId = `gap:${input.id}`;
  nodes.push({ id: blockId, kind: 'gap', label: input.label, sublabel: input.id });
  nodes.push({
    id: 'decision',
    kind: 'decision',
    label: input.next,
    sublabel: `${input.owner.toLowerCase().replace(/_/g, ' ')} decides`,
  });

  if (facts.length === 0) link(`record:${rootId}`, ruleId);
  for (const fact of facts) {
    link(`record:${rootId}`, `fact:${fact.key}`);
    link(`fact:${fact.key}`, ruleId);
  }
  for (const id of evidence) link(`record:${id}`, ruleId);
  link(ruleId, blockId);
  link(blockId, 'decision');

  const { positions, width, height } = layoutDag(
    nodes.map((n) => ({ id: n.id, w: NODE_W, h: NODE_H })),
    edges,
  );
  const placed: MapNode[] = nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: 0, y: 0, w: NODE_W, h: NODE_H }),
  }));
  return { nodes: placed, edges, blockId, width, height };
}

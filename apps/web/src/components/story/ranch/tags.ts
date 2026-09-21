import type { HorseAttach } from '@/components/story/horse-shape';
import type { OperationsSummary, Xray, XrayNode } from '@/lib/types';

/**
 * What the threshold scene says with: the records that attach to her (the x-ray's own nodes),
 * the five contexts and what each holds open, and the arithmetic of a scroll-linked scene.
 * Shared by the drawn scene and the built one, so they tell the same story.
 */
export const STAGE = { doors: [0, 0.14], walk: [0.12, 0.56], tags: [0.36, 0.62], graph: [0.64, 0.9] } as const;
export const MAX_TAGS = 9;

export const CONTEXTS: { label: string; sources: string[] }[] = [
  { label: 'Reproduction', sources: ['REPRODUCTION', 'INTAKE'] },
  { label: 'Veterinary', sources: ['VETERINARY'] },
  { label: 'Billing', sources: ['BILLING', 'STRIPE'] },
  { label: 'Accounting', sources: ['RECONCILIATION', 'QBO'] },
  { label: 'Operations', sources: ['QUEUE', 'INTEGRATION', 'SYSTEM'] },
];

export function contextCounts(summary: OperationsSummary | null): number[] {
  return CONTEXTS.map((c) =>
    Object.entries(summary?.bySource ?? {}).reduce((n, [source, v]) => n + (c.sources.includes(source) ? v : 0), 0),
  );
}

export interface Tag {
  node: XrayNode;
  attach: HorseAttach | null;
  /** Where the tag floats, relative to its attach point on her, in fractions of her box (the drawn scene) or metres (the built one). */
  offset: readonly [number, number];
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const span = (p: number, [a, b]: readonly [number, number]) => clamp01((p - a) / (b - a));
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The nodes the block was read from, back to the mare, and the person it hands to. */
function causalChain(xray: Xray): Set<string> {
  const chain = new Set<string>();
  if (!xray.blockId) return chain;
  chain.add(xray.blockId);
  const queue = [xray.blockId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const edge of xray.edges) {
      if (edge.to === id && !chain.has(edge.from)) {
        chain.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  for (const edge of xray.edges) if (edge.from === xray.blockId) chain.add(edge.to);
  return chain;
}

/**
 * The records that attach to her, in the order they arrive; the rule, the block and the person
 * join only in the graph. Where the x-ray has a choice, the node on the causal path wins, so
 * the graph she becomes is the chain that blocks her.
 */
export function pickTags(xray: Xray | null): Tag[] {
  if (!xray) return [];
  const chain = causalChain(xray);
  const nodes = [...xray.nodes].sort((a, b) => Number(chain.has(b.id)) - Number(chain.has(a.id)));
  const used = new Set<string>();
  const take = (
    predicate: (n: XrayNode) => boolean,
    attach: HorseAttach | null,
    offset: readonly [number, number],
  ): Tag | null => {
    const node = nodes.find((n) => !used.has(n.id) && predicate(n));
    if (!node) return null;
    used.add(node.id);
    return { node, attach, offset };
  };
  const picks = [
    take((n) => n.type === 'subject', 'withers', [-0.22, -0.3]),
    take((n) => n.type === 'record' && /^E-/.test(n.label), 'belly', [0.02, 0.34]),
    take(
      (n) => n.type === 'record' && /heartbeat|check|CHK/i.test(`${n.label} ${n.sublabel ?? ''}`),
      'head',
      [0.1, -0.28],
    ),
    take((n) => n.type === 'fact', 'croup', [-0.3, -0.24]),
    take((n) => n.type === 'money', 'chest', [0.34, 0.06]),
    take((n) => n.type === 'gap', 'flank', [-0.38, 0.14]),
    take((n) => n.type === 'rule', null, [0, 0]),
    take((n) => n.id === xray.blockId, null, [0, 0]),
    take((n) => n.type === 'decision', null, [0, 0]),
  ];
  return picks.filter((t): t is Tag => t !== null);
}

/** A phone shows the chain, not the whole set: her, the embryo, what is missing, the block, the person. */
export function onPhone(tag: Tag, xray: Xray | null): boolean {
  return (
    tag.node.type === 'subject' ||
    tag.node.type === 'gap' ||
    tag.node.type === 'decision' ||
    tag.node.id === xray?.blockId ||
    (tag.node.type === 'record' && /^E-/.test(tag.node.label))
  );
}

/** When each tag arrives on her. */
export function arrival(index: number): readonly [number, number] {
  return [STAGE.tags[0] + index * 0.045, STAGE.tags[0] + index * 0.045 + 0.06];
}

/**
 * Where the records settle: the x-ray's own columns in its order, spread evenly in a box so no
 * tag sits on another; a phone reads the chain down the screen, stepping left and right.
 * Positions are unit fractions of the box, x to the right and y down.
 */
export function layout(tags: Tag[], visible: boolean[], phone: boolean): Map<string, [number, number]> {
  const placed = tags.filter((_, i) => visible[i]);
  const columns = [...new Set(placed.map((t) => t.node.x))].sort((a, b) => a - b);
  const at = new Map<string, [number, number]>();
  if (phone) {
    const chain = columns.flatMap((x) => placed.filter((t) => t.node.x === x).sort((a, b) => a.node.y - b.node.y));
    chain.forEach((t, k) => at.set(t.node.id, [k % 2 === 0 ? 0.3 : 0.7, (k + 0.5) / chain.length]));
    return at;
  }
  columns.forEach((x, ci) => {
    const rows = placed.filter((t) => t.node.x === x).sort((a, b) => a.node.y - b.node.y);
    rows.forEach((t, ri) => at.set(t.node.id, [(ci + 0.5) / columns.length, (ri + 0.5) / rows.length]));
  });
  return at;
}

export const TONE: Record<XrayNode['status'], string> = {
  blocked: 'bg-warn',
  ok: 'bg-ok',
  due: 'bg-paper',
  watch: 'bg-muted-foreground',
  neutral: 'bg-copper-2',
};

import { createHash } from 'node:crypto';
import { daysBetween, formatUsd, type BarnDate, type RuleResult } from '@daysheet/domain';
import { layoutDag } from '../../../platform/layout/dag';

/**
 * The operational X-ray of one mare: every record the systems hold about her, the rules that
 * read them, what those rules found missing, the signals that raised, and the person the whole
 * chain waits for — as one evidence graph. Nothing here is generated: each node stands for a
 * row (and says which), each rule node is a rule that ran, the conclusion is the leading
 * signal's own words. Derived from the story read model, laid out once on the API.
 */
export type XrayNodeType = 'subject' | 'record' | 'fact' | 'rule' | 'gap' | 'signal' | 'money' | 'decision';
export type XrayStatus = 'ok' | 'blocked' | 'due' | 'watch' | 'neutral';

export interface XrayNode {
  id: string;
  type: XrayNodeType;
  label: string;
  sublabel?: string;
  status: XrayStatus;
  /** The context that owns the row: reproduction, veterinary, billing, accounting, operations, rules. */
  source: string;
  /** The record code the node stands for, when it stands for one. */
  recordRef?: string;
  occurredAt?: string;
  facts: { key: string; value: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface XrayEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
}

export interface XrayRule {
  code: string;
  label: string;
  verdict: 'ok' | 'blocked';
  reason: string | null;
  evidenceIds: string[];
}

export interface Xray {
  subject: string;
  asOf: string;
  /** A fingerprint of every fact drawn, so an answer can be pinned to the state it explained. */
  stateHash: string;
  conclusion: string;
  unresolvedBoundary: { owner: string; reason: string; next: string; signalId: string; source: string } | null;
  /** The block by name: which signal, of what kind, about which record — so a reader can pick the right door without parsing a node id. */
  block: { signalId: string; kind: string; label: string; entityId: string | null } | null;
  rulesApplied: XrayRule[];
  blockId: string | null;
  /** The signal the reader arrived from, when it is one of hers: lit, so the graph answers that card. */
  focusId: string | null;
  nodes: XrayNode[];
  edges: XrayEdge[];
  width: number;
  height: number;
}

export interface XraySignal {
  id: string;
  kind: string;
  label: string;
  severity: string;
  source: string;
  title: string;
  entityId: string | null;
  rule: string | null;
  state: { key: string; value: string }[];
  meaning: string;
  owner: string;
  next: string;
  stakeCents: number | null;
  createdAt: string;
}

export interface XrayInput {
  today: BarnDate;
  asOf: string;
  recip: {
    id: string;
    number: number | null;
    status: string | null;
    clearances: { id: string; kind: string; result: string; performedOn: string; expiresOn: string | null }[];
    departure: { scheduledDepartureOn: BarnDate; rule: RuleResult } | null;
  };
  embryo: { id: string; status: string; cross: string; customer: { name: string } };
  pregnancy: {
    transferId: string;
    transferredOn: BarnDate;
    gestationDay: number;
    lastCheck: { id: string; day: number; result: string; on: string } | null;
    nextMilestone: number | null;
  };
  money: {
    invoices: {
      id: string;
      kind: string;
      status: string;
      amountCents: number;
      payments: { id: string; status: string; amountCents: number }[];
    }[];
    books: { entityId: string; status: string; lastError: string | null }[];
  };
  signals: XraySignal[];
  /** Requests to the team already open about her: the next step in motion, drawn after the person who sent it. */
  requests?: { id: string; subject: string; since: string }[];
}

const NODE_W = 208;
const NODE_H = 46;
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

/** What kind of judgment each owner's decision is: the reason the assistant stops at the boundary. */
export const AUTHORITY_REASON: Record<string, string> = {
  VET: 'a veterinary judgment: the assistant may prepare the request, never record the result',
  BILLING: 'a financial decision: the assistant may explain the money, never move it',
  RECIPS: 'an operational call on the recip farm, made by the person who sees the mare',
  STALLION_OFFICE: 'a contract decision, made by the office that signed it',
  ADMIN: 'a management decision',
};

const lower = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/** `focusSignalId`: the decision the reader arrived from; when it is one of hers, it is the block the graph answers. */
export function xrayFor(input: XrayInput, focusSignalId: string | null = null): Xray {
  const nodes: Omit<XrayNode, 'x' | 'y' | 'w' | 'h'>[] = [];
  const edges: XrayEdge[] = [];
  const link = (from: string, to: string, relation: string) => {
    if (nodes.some((n) => n.id === from) && nodes.some((n) => n.id === to))
      edges.push({ id: `${from}->${to}`, from, to, relation });
  };
  const rulesApplied: XrayRule[] = [];

  // The mare, and the embryo she carries.
  const recip = input.recip;
  const subjectId = `record:${recip.id}`;
  const departureDays = recip.departure ? daysBetween(input.today, recip.departure.scheduledDepartureOn) : null;
  nodes.push({
    id: subjectId,
    type: 'subject',
    label: recip.id,
    sublabel: `Recip #${recip.number ?? '?'} · ${recip.status ? lower(recip.status) : 'status unknown'}`,
    status: 'neutral',
    source: 'reproduction',
    recordRef: recip.id,
    facts: [
      { key: 'status', value: recip.status ? lower(recip.status) : '—' },
      ...(recip.departure
        ? [
            {
              key: 'leaves',
              value: `${recip.departure.scheduledDepartureOn} (in ${departureDays} day${departureDays === 1 ? '' : 's'})`,
            },
          ]
        : []),
    ],
  });
  const embryoId = `record:${input.embryo.id}`;
  nodes.push({
    id: embryoId,
    type: 'record',
    label: input.embryo.id,
    sublabel: `embryo · ${lower(input.embryo.status)}`,
    status: 'neutral',
    source: 'reproduction',
    recordRef: input.embryo.id,
    facts: [
      { key: 'status', value: lower(input.embryo.status) },
      { key: 'cross', value: input.embryo.cross },
      { key: 'owner', value: input.embryo.customer.name },
    ],
  });
  link(subjectId, embryoId, 'carries');

  // The pregnancy as the vet's record holds it: the day, the last check, the next milestone.
  const preg = input.pregnancy;
  const checkDue = preg.nextMilestone !== null && preg.gestationDay >= preg.nextMilestone;
  const pregId = `record:${preg.transferId}`;
  nodes.push({
    id: pregId,
    type: 'record',
    label: `day ${preg.gestationDay}`,
    sublabel: `in foal since ${preg.transferredOn}`,
    status: checkDue ? 'due' : 'ok',
    source: 'reproduction',
    recordRef: preg.transferId,
    facts: [
      { key: 'transferred', value: preg.transferredOn },
      { key: 'gestation day', value: String(preg.gestationDay) },
      { key: 'next milestone', value: preg.nextMilestone === null ? 'none' : `day ${preg.nextMilestone}` },
    ],
  });
  link(embryoId, pregId, 'transferred');
  if (preg.lastCheck) {
    const checkId = `record:${preg.lastCheck.id}`;
    nodes.push({
      id: checkId,
      type: 'record',
      label: `day ${preg.lastCheck.day} · ${lower(preg.lastCheck.result)}`,
      sublabel: `check ${preg.lastCheck.id}`,
      status: 'ok',
      source: 'veterinary',
      recordRef: preg.lastCheck.id,
      occurredAt: preg.lastCheck.on,
      facts: [
        { key: 'day', value: String(preg.lastCheck.day) },
        { key: 'result', value: lower(preg.lastCheck.result) },
        { key: 'on', value: preg.lastCheck.on },
      ],
    });
    link(pregId, checkId, 'last checked');
  }
  const checkSignal = input.signals.find((s) => s.kind === 'CHECK_OVERDUE');
  if (checkDue || checkSignal) {
    const gapId = 'gap:check';
    nodes.push({
      id: gapId,
      type: 'gap',
      label: `day-${preg.nextMilestone ?? preg.gestationDay} check missing`,
      sublabel: checkSignal ? 'overdue' : 'due',
      status: checkSignal ? 'blocked' : 'due',
      source: 'rules',
      facts: [
        { key: 'due since', value: `day ${preg.nextMilestone ?? preg.gestationDay}` },
        { key: 'today', value: `day ${preg.gestationDay}` },
      ],
    });
    link(pregId, gapId, 'requires');
  }

  // Leaving: the lease's rule, the video it wants, and what it found.
  if (recip.departure) {
    const rule = recip.departure.rule;
    const depId = 'fact:departure';
    nodes.push({
      id: depId,
      type: 'fact',
      label: `leaves ${recip.departure.scheduledDepartureOn}`,
      sublabel:
        departureDays !== null && departureDays >= 0
          ? `in ${departureDays} day${departureDays === 1 ? '' : 's'}`
          : 'departure date passed',
      status: rule.ok ? 'ok' : 'blocked',
      source: 'reproduction',
      facts: [{ key: 'scheduled', value: recip.departure.scheduledDepartureOn }],
    });
    link(subjectId, depId, 'scheduled');
    const video = recip.clearances.find((c) => c.kind === 'VIDEO_IN_FOAL');
    let videoId: string;
    if (video) {
      videoId = `record:${video.id}`;
      nodes.push({
        id: videoId,
        type: 'record',
        label: `video · ${lower(video.result)}`,
        sublabel: video.id,
        status: rule.ok ? 'ok' : 'watch',
        source: 'veterinary',
        recordRef: video.id,
        occurredAt: video.performedOn,
        facts: [
          { key: 'kind', value: 'video in foal' },
          { key: 'result', value: lower(video.result) },
          { key: 'performed', value: video.performedOn },
        ],
      });
    } else {
      videoId = 'gap:video';
      nodes.push({
        id: videoId,
        type: 'gap',
        label: 'video-confirmed in foal: none',
        sublabel: 'the lease requires it',
        status: rule.ok ? 'neutral' : 'blocked',
        source: 'rules',
        facts: [{ key: 'required', value: 'a VIDEO_IN_FOAL clearance within 3 days of departure' }],
      });
    }
    link(subjectId, videoId, 'evidence');
    const ruleId = 'rule:departure';
    nodes.push({
      id: ruleId,
      type: 'rule',
      label: 'DepartureRule',
      sublabel: rule.ok ? 'satisfied' : rule.code,
      status: rule.ok ? 'ok' : 'blocked',
      source: 'rules',
      facts: [{ key: 'verdict', value: rule.ok ? 'may leave' : rule.reason }],
    });
    link(depId, ruleId, 'read by');
    link(videoId, ruleId, 'read by');
    rulesApplied.push({
      code: rule.ok ? 'DEPARTURE_OK' : rule.code,
      label: 'DepartureRule',
      verdict: rule.ok ? 'ok' : 'blocked',
      reason: rule.ok ? null : rule.reason,
      evidenceIds: rule.evidenceIds,
    });
  }

  // The money the season attached to her: each invoice once, its payments as facts.
  for (const invoice of input.money.invoices) {
    const id = `record:${invoice.id}`;
    const paid = invoice.payments.filter((p) => p.status === 'SUCCEEDED').reduce((sum, p) => sum + p.amountCents, 0);
    nodes.push({
      id,
      type: 'money',
      label: `${formatUsd(invoice.amountCents)} · ${lower(invoice.kind)}`,
      sublabel: invoice.status === 'PAID' ? 'paid' : `${lower(invoice.status)} · ${formatUsd(paid)} received`,
      status: invoice.status === 'PAID' ? 'ok' : invoice.status === 'OPEN' ? 'due' : 'neutral',
      source: 'billing',
      recordRef: invoice.id,
      facts: [
        { key: 'amount', value: formatUsd(invoice.amountCents) },
        { key: 'status', value: lower(invoice.status) },
        ...invoice.payments.map((p) => ({ key: p.id, value: `${lower(p.status)} · ${formatUsd(p.amountCents)}` })),
      ],
    });
    link(embryoId, id, 'billed');
    const books = input.money.books.find((b) => b.entityId === invoice.id);
    if (books && books.status !== 'SYNCED') {
      const bookId = `fact:books:${invoice.id}`;
      nodes.push({
        id: bookId,
        type: 'fact',
        label: `books · ${lower(books.status)}`,
        sublabel: books.lastError ? books.lastError.slice(0, 40) : 'not yet in the books',
        status: 'watch',
        source: 'accounting',
        facts: [
          { key: 'status', value: lower(books.status) },
          ...(books.lastError ? [{ key: 'last error', value: books.lastError.slice(0, 120) }] : []),
        ],
      });
      link(id, bookId, 'synced to');
    }
  }

  // Every open signal about her, attached to the row it is about; the leading one is the block.
  const ranked = [...input.signals].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      (b.stakeCents ?? 0) - (a.stakeCents ?? 0) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const focus = focusSignalId ? (ranked.find((s) => s.id === focusSignalId) ?? null) : null;
  const block = focus ?? ranked[0] ?? null;
  for (const signal of ranked) {
    const id = `signal:${signal.id}`;
    nodes.push({
      id,
      type: 'signal',
      label: signal.label,
      sublabel: signal.id,
      status: signal.severity === 'INFO' ? 'watch' : 'blocked',
      source: signal.source.toLowerCase(),
      recordRef: signal.id,
      occurredAt: signal.createdAt,
      facts: [...signal.state, { key: 'means', value: signal.meaning }],
    });
    const from =
      signal.kind === 'DEPARTURE_UNCONFIRMED' && recip.departure
        ? 'rule:departure'
        : signal.kind === 'CHECK_OVERDUE'
          ? 'gap:check'
          : signal.entityId
            ? `record:${signal.entityId}`
            : subjectId;
    link(nodes.some((n) => n.id === from) ? from : subjectId, id, 'raised');
    if (signal.rule && !rulesApplied.some((r) => r.code === signal.rule))
      rulesApplied.push({
        code: signal.rule,
        label: signal.label,
        verdict: 'blocked',
        reason: signal.meaning,
        evidenceIds: signal.entityId ? [signal.entityId] : [],
      });
  }
  const decisionId = 'decision';
  if (block) {
    nodes.push({
      id: decisionId,
      type: 'decision',
      label: `${lower(block.owner)} decides`,
      sublabel: block.next,
      status: 'blocked',
      source: 'people',
      facts: [
        { key: 'owner', value: lower(block.owner) },
        { key: 'next', value: block.next },
        { key: 'why a person', value: AUTHORITY_REASON[block.owner] ?? 'a decision the rules leave to a person' },
      ],
    });
    link(`signal:${block.id}`, decisionId, 'waits for');
  } else {
    nodes.push({
      id: decisionId,
      type: 'decision',
      label: 'nothing waits on a person',
      sublabel: 'no open signal',
      status: 'ok',
      source: 'people',
      facts: [],
    });
    link(subjectId, decisionId, 'clear');
  }
  // A request already sent is the next step in motion: it hangs off the person, and it is part of the state.
  for (const request of input.requests ?? []) {
    const id = `record:${request.id}`;
    nodes.push({
      id,
      type: 'record',
      label: `request · open`,
      sublabel: request.id,
      status: 'watch',
      source: 'people',
      recordRef: request.id,
      occurredAt: request.since,
      facts: [
        { key: 'subject', value: request.subject },
        { key: 'since', value: request.since },
        { key: 'status', value: 'open · waiting for the answer' },
      ],
    });
    link(decisionId, id, 'sent');
  }

  const { positions, width, height } = layoutDag(
    nodes.map((n) => ({ id: n.id, w: NODE_W, h: NODE_H })),
    edges,
    { nodesep: 12, ranksep: 48 },
  );
  const placed: XrayNode[] = nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: 0, y: 0, w: NODE_W, h: NODE_H }),
  }));
  // The fingerprint is the world's, not the reader's: the decision node follows the block a reader
  // arrived from, so it stays out, and the same records give the same hash from any signal.
  const stateHash = createHash('sha256')
    .update(JSON.stringify(placed.filter((n) => n.type !== 'decision').map((n) => [n.id, n.status, n.facts])))
    .digest('hex')
    .slice(0, 16);
  return {
    subject: recip.id,
    asOf: input.asOf,
    stateHash,
    conclusion: block ? block.meaning : `${recip.id} has no open signal: nothing about her waits on a person today.`,
    unresolvedBoundary: block
      ? {
          owner: block.owner,
          reason: AUTHORITY_REASON[block.owner] ?? 'a decision the rules leave to a person',
          next: block.next,
          signalId: block.id,
          source: block.source,
        }
      : null,
    block: block ? { signalId: block.id, kind: block.kind, label: block.label, entityId: block.entityId } : null,
    rulesApplied,
    blockId: block ? `signal:${block.id}` : null,
    focusId: focus ? `signal:${focus.id}` : null,
    nodes: placed,
    edges,
    width,
    height,
  };
}

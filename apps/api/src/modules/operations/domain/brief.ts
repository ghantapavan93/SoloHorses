import { addDays, type BarnDate } from '@daysheet/domain';

/**
 * The morning brief's arithmetic, kept pure: which open rows a person reads first, which
 * recorded snapshot counts as "yesterday", how the audit trail since then groups into the
 * estate's contexts, and how the next two days sort. The service gathers rows; nothing here
 * touches a table, so each rule is a test.
 */

export interface NeedsYouRow {
  id: string;
  kind: string;
  label: string;
  title: string;
  severity: string;
  source: string;
  entityId: string | null;
  stakeCents: number | null;
  stakeLabel: string | null;
  owner: string;
  next: string;
  surface: string;
  createdAt: string;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

/** Severity first, then the dollars a row holds up, then age: the oldest unresolved item before a newer one. */
export function rankNeedsYou<T extends { severity: string; stakeCents: number | null; createdAt: string }>(
  rows: T[],
  limit = 5,
): T[] {
  return [...rows]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        (b.stakeCents ?? 0) - (a.stakeCents ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, limit);
}

/**
 * The rows the reader owns: the ones whose next step is theirs to take. A founder owns every
 * decision, so an admin's brief counts them all; every other role sees its own first, then the
 * rest of the board in the same order.
 */
export function mine<T extends { owner: string }>(rows: T[], role: string): T[] {
  return role === 'ADMIN' ? rows : rows.filter((r) => r.owner === role);
}

/** The reader's own rows first, ranked; the others after, ranked; never more than the limit. */
export function rankForReader<
  T extends { owner: string; severity: string; stakeCents: number | null; createdAt: string },
>(rows: T[], role: string, limit = 5): T[] {
  const own = new Set(mine(rows, role));
  const first = rankNeedsYou([...own], limit);
  const rest = rankNeedsYou(
    rows.filter((r) => !own.has(r)),
    limit,
  );
  return [...first, ...rest].slice(0, limit);
}

export interface SnapshotPoint {
  id: string;
  /** ISO instant, UTC. */
  takenAt: string;
  open: number;
  atStakeCents: number;
}

/**
 * "Yesterday" is the last snapshot taken before today began at the barn. Until the first day
 * ends there is none, and the brief says so rather than inventing a baseline.
 */
export function baselineFor(points: SnapshotPoint[], todayStart: string): SnapshotPoint | null {
  const before = points.filter((p) => p.takenAt < todayStart).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return before[0] ?? null;
}

export type BriefContext =
  'reproduction' | 'veterinary' | 'billing' | 'accounting' | 'integrations' | 'assistant' | 'board';

/** Audit actions, by the bounded context that owns them. Order matters: the books' view of an invoice is accounting, not billing. */
const CONTEXT_OF: [RegExp, BriefContext][] = [
  [/^(check|clearance|return_assessment)\./, 'veterinary'],
  [/^(embryo|transfer|contract|intake|horse|recip|order|semen_order|aspiration|lab_batch)\./, 'reproduction'],
  [/^(invoice\.amount_accepted_from_books|discrepancy\.|reconciliation\.|books\.)/, 'accounting'],
  [/^(invoice|payment|document|lot|refund|implant_fee|settlement)\./, 'billing'],
  [/^(job|message|webhook|integration|lab)\./, 'integrations'],
  [/^(ask|proposal|request)\./, 'assistant'],
  [/^exceptions?\./, 'board'],
];

/** The board's own raise and resolve rows are listed by the brief already; the sweep's heartbeat is not a change. */
const NOT_A_CHANGE = new Set(['exceptions.detected', 'exception.raised', 'exception.resolved']);

export interface ChangeGroup {
  context: BriefContext;
  count: number;
  actions: { action: string; label: string; count: number; last: string }[];
}

export function contextOf(action: string): BriefContext {
  for (const [pattern, context] of CONTEXT_OF) if (pattern.test(action)) return context;
  return 'integrations';
}

/** `payment.webhook_redelivered` reads "payment webhook redelivered": the trail's own words, without the punctuation. */
export function describeAction(action: string): string {
  return action.replace(/[._]/g, ' ');
}

/** What the audit trail recorded since the baseline, by context, largest first; each action counted once per row. */
export function groupChanges(events: { action: string; at: string }[]): ChangeGroup[] {
  const byAction = new Map<string, { count: number; last: string }>();
  for (const event of events) {
    if (NOT_A_CHANGE.has(event.action)) continue;
    const current = byAction.get(event.action);
    if (current) {
      current.count += 1;
      if (event.at > current.last) current.last = event.at;
    } else {
      byAction.set(event.action, { count: 1, last: event.at });
    }
  }
  const groups = new Map<BriefContext, ChangeGroup>();
  for (const [action, { count, last }] of byAction) {
    const context = contextOf(action);
    const group = groups.get(context) ?? { context, count: 0, actions: [] };
    group.count += count;
    group.actions.push({ action, label: describeAction(action), count, last });
    groups.set(context, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      actions: group.actions.sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)),
    }))
    .sort((a, b) => b.count - a.count || a.context.localeCompare(b.context));
}

export type LookaheadState = 'ready' | 'blocked' | 'due' | 'watch';

export interface LookaheadItem {
  on: BarnDate;
  kind: 'departure' | 'embryo_expected' | 'milestone' | 'lab_result' | 'invoice_due' | 'settlement_due' | 'collection';
  label: string;
  entityId: string | null;
  state: LookaheadState;
  note: string;
  amountCents?: number;
}

const STATE_RANK: Record<LookaheadState, number> = { blocked: 0, due: 1, watch: 2, ready: 3 };

/** The days a 48-hour lookahead covers: today and tomorrow, as barn dates. */
export function lookaheadDays(today: BarnDate): BarnDate[] {
  return [today, addDays(today, 1)];
}

/** By day; within a day the blocked thing first, then what is due, then what to watch, then what is ready. */
export function sortLookahead(items: LookaheadItem[]): LookaheadItem[] {
  return [...items].sort(
    (a, b) => a.on.localeCompare(b.on) || STATE_RANK[a.state] - STATE_RANK[b.state] || a.label.localeCompare(b.label),
  );
}

// ───────────────────────────── the morning brief ─────────────────────────────

/** How soon a person is needed, in one word the card can wear. */
export type Urgency = 'now' | 'today' | 'watch';

export function urgencyOf(severity: string): Urgency {
  return severity === 'CRITICAL' ? 'now' : severity === 'WARN' ? 'today' : 'watch';
}

export interface MorningDecision {
  id: string;
  /** The kind's own name: the headline a person scans before the sentence. */
  label: string;
  title: string;
  /** What it means to the person who acts, in the board's words. */
  reason: string;
  urgency: Urgency;
  owner: string;
  ownerName: string | null;
  /** How many facts from the records stand behind it. */
  evidence: number;
  stakeCents: number | null;
  stakeLabel: string | null;
  next: string;
  surface: string;
  entityId: string | null;
  createdAt: string;
}

/** Open rows by the role that takes the next step, and by the channel they arrive on. */
export function breakdown<T extends { owner: string; channel: string }>(
  rows: T[],
): { byOwner: Record<string, number>; byChannel: Record<string, number> } {
  const byOwner: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const r of rows) {
    byOwner[r.owner] = (byOwner[r.owner] ?? 0) + 1;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
  }
  return { byOwner, byChannel };
}

/**
 * Three questions worth asking this morning, chosen from the board as it stands: what moved
 * when something did, the reader's own share, and the owner with the most waiting. Never a
 * fixed list — a quiet accounting day does not suggest accounting.
 */
export function promptsFor(
  rows: { owner: string; channel: string; stakeCents: number | null }[],
  role: string,
  changed: number,
): string[] {
  const prompts = [
    changed > 0 ? 'What changed overnight?' : 'What needs a person today?',
    role === 'ADMIN' ? 'What is at stake today?' : 'What needs me personally?',
  ];
  const lead =
    Object.entries(breakdown(rows).byOwner).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const money = rows.some((r) => (r.stakeCents ?? 0) > 0);
  if (lead === 'VET') prompts.push('What needs the vet?');
  else if (lead === 'BILLING' || money) prompts.push('Where is money blocked?');
  else if (lead === 'RECIPS') prompts.push('What needs the recip farm?');
  else prompts.push('What is at stake today?');
  return Array.from(new Set(prompts)).slice(0, 3);
}

/**
 * The same world gives the same id: the open rows, each with its status and its stake, sorted
 * by id, hashed. A card that was made against one state can be checked against the state now.
 */
export function stateIdOf(
  rows: { id: string; status: string; stakeCents: number | null }[],
  hash: (text: string) => string,
): string {
  const text = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => `${r.id}:${r.status}:${r.stakeCents ?? ''}`)
    .join('|');
  return hash(text).slice(0, 12);
}

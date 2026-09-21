import {
  can,
  evaluateDeparture,
  type BarnDate,
  type ClearanceRecord,
  type Role,
  type RuleResult,
} from '@daysheet/domain';
import type { DepartureRead, PlannedRecipientRead } from '../../reproduction/application/transfers.service';
import { PROPOSAL_KINDS } from './proposals';

/**
 * A decision as a diff: the rows a yes would change, from what to what, beside the rows the rule
 * reads and leaves alone — drawn from exactly the reads the proposal's fingerprint is taken of,
 * so what the person sees is what the approval is bound to. Nothing here writes; the same
 * service the UI calls runs at approval, and refuses if these reads have moved.
 */
export interface DiffLine {
  /** The record the line is about. */
  record: string;
  source: 'reproduction' | 'veterinary' | 'people';
  field: string;
  before: string;
  after: string;
  /** False for a fact the rule reads and a yes leaves as it is. */
  changes: boolean;
}

export interface DecisionDiff {
  proposalId: string;
  kind: string;
  status: string;
  label: string;
  subject: string;
  stateHashAtProposal: string | null;
  stateHashNow: string;
  /** A waiting proposal whose reads have moved: approving it would be refused. */
  stale: boolean;
  lines: DiffLine[];
  /** The rule a yes runs, as it stands now — a preview, never the run. */
  rule: { code: string; label: string; verdict: 'ok' | 'blocked'; reason: string | null } | null;
  executes: string;
  willNot: string[];
  approver: string;
  riskClass: string;
  /** Who may say yes: the roles that write the resource the kind names; the rule runs again at the click. */
  authority: { resource: string; roles: string[] };
}

const STAFF: Role[] = ['ADMIN', 'STALLION_OFFICE', 'RECIPS', 'VET', 'BILLING'];

const lower = (value: string | null | undefined) => (value ? value.toLowerCase().replace(/_/g, ' ') : '—');

export function plannedRecipientLines(
  payload: { embryoId: string; recipientId: string },
  read: PlannedRecipientRead,
): DiffLine[] {
  const { embryoId, recipientId } = payload;
  const heldFor = read.recip?.planned.filter((id) => id !== embryoId) ?? [];
  return [
    {
      record: embryoId,
      source: 'reproduction',
      field: 'planned recipient',
      before: read.embryo?.plannedRecipientId ?? 'none',
      after: recipientId,
      changes: read.embryo?.plannedRecipientId !== recipientId,
    },
    {
      record: recipientId,
      source: 'reproduction',
      field: 'held for',
      before: heldFor.length ? heldFor.join(', ') : 'nobody',
      after: [...heldFor, embryoId].join(', '),
      changes: !read.recip?.planned.includes(embryoId),
    },
    {
      record: recipientId,
      source: 'reproduction',
      field: 'status',
      before: lower(read.recip?.recipStatus),
      after: lower(read.recip?.recipStatus),
      changes: false,
    },
    {
      record: recipientId,
      source: 'reproduction',
      field: 'carrying',
      before: read.recip?.carrying.length ? read.recip.carrying.join(', ') : 'nothing',
      after: read.recip?.carrying.length ? read.recip.carrying.join(', ') : 'nothing',
      changes: false,
    },
    {
      record: embryoId,
      source: 'reproduction',
      field: 'embryo status',
      before: lower(read.embryo?.status),
      after: lower(read.embryo?.status),
      changes: false,
    },
  ];
}

export function departureLines(
  payload: { recipId: string; subject: string },
  read: DepartureRead,
  pending: { id: string; subject: string }[],
): DiffLine[] {
  const open = pending.map((r) => r.id);
  const video = (read?.clearances ?? []).filter((c) => c.includes(':VIDEO_IN_FOAL:'));
  return [
    {
      record: payload.recipId,
      source: 'people',
      field: 'request to the vet',
      before: open.length ? `pending · ${open.join(', ')}` : 'none',
      after: `“${payload.subject}” · sent under the approver’s name`,
      changes: true,
    },
    {
      record: payload.recipId,
      source: 'reproduction',
      field: 'leaves',
      before: read?.scheduledDepartureOn?.slice(0, 10) ?? 'no date',
      after: read?.scheduledDepartureOn?.slice(0, 10) ?? 'no date',
      changes: false,
    },
    {
      record: payload.recipId,
      source: 'veterinary',
      field: 'video-confirmed in foal',
      before: video.length ? video.map((c) => c.split(':')[0]).join(', ') : 'none on record',
      after: video.length ? video.map((c) => c.split(':')[0]).join(', ') : 'none on record',
      changes: false,
    },
    {
      record: payload.recipId,
      source: 'veterinary',
      field: 'clearances on record',
      before: String(read?.clearances.length ?? 0),
      after: String(read?.clearances.length ?? 0),
      changes: false,
    },
  ];
}

/** The departure rule, run over the read the fingerprint binds: what a yes would send the vet about, as it stands. */
export function departureVerdict(recipId: string, read: DepartureRead, today: BarnDate): RuleResult | null {
  if (!read?.scheduledDepartureOn) return null;
  const clearances: ClearanceRecord[] = read.clearances.map((line) => {
    const [id, kind, result, performedOn] = line.split(':');
    return {
      id: id ?? '',
      kind: kind as ClearanceRecord['kind'],
      result: result as ClearanceRecord['result'],
      performedOn: performedOn ?? '',
      expiresOn: null,
    };
  });
  return evaluateDeparture(
    { id: recipId, scheduledDepartureOn: read.scheduledDepartureOn.slice(0, 10), clearances },
    today,
  );
}

export function decisionDiff(input: {
  proposalId: string;
  kind: keyof typeof PROPOSAL_KINDS;
  status: string;
  subject: string;
  stateHashAtProposal: string | null;
  stateHashNow: string;
  lines: DiffLine[];
  rule: DecisionDiff['rule'];
}): DecisionDiff {
  const spec = PROPOSAL_KINDS[input.kind];
  return {
    proposalId: input.proposalId,
    kind: input.kind,
    status: input.status,
    label: spec.label,
    subject: input.subject,
    stateHashAtProposal: input.stateHashAtProposal,
    stateHashNow: input.stateHashNow,
    // Approval compared the fingerprints at the click; a decided row is not re-judged by what moved after.
    stale:
      input.status === 'STALE' ||
      (input.status === 'PROPOSED' &&
        input.stateHashAtProposal !== null &&
        input.stateHashAtProposal !== input.stateHashNow),
    lines: input.lines,
    rule: input.rule,
    executes: spec.executes,
    willNot: spec.willNot,
    approver: spec.approver,
    riskClass: spec.riskClass,
    authority: {
      resource: spec.approver,
      roles: STAFF.filter((role) => can({ userId: '', role, customerId: null }, 'write', spec.approver)),
    },
  };
}

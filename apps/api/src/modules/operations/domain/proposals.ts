import type { ProposalKind } from '@daysheet/db';

/**
 * The catalog of what the assistant may prepare. Each kind names the one service call that
 * runs at approval, who may approve, what the act will never do, and the words the decision
 * diff shows before and after. A kind that is not here cannot be proposed; a generic mutation
 * does not exist (ADR-017).
 */
export interface ProposalKindSpec {
  kind: ProposalKind;
  label: string;
  /** The service call that runs at approval, named so the reader can find it. */
  executes: string;
  /** The write permission the approver needs. */
  approver: 'embryo' | 'operations';
  riskClass: 'LOW' | 'MEDIUM';
  willNot: string[];
  before: (payload: Record<string, unknown>) => string;
  after: (payload: Record<string, unknown>) => string;
}

const text = (value: unknown, fallback = '?'): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

export const PROPOSAL_KINDS: Record<ProposalKind, ProposalKindSpec> = {
  ASSIGN_PLANNED_RECIPIENT: {
    kind: 'ASSIGN_PLANNED_RECIPIENT',
    label: 'Hold a recip for an arriving embryo',
    executes: 'TransfersService.assignPlannedRecipient — the same rule the Day Sheet runs',
    approver: 'embryo',
    riskClass: 'LOW',
    willNot: [
      'record a transfer',
      'change a clearance',
      'change a pregnancy status',
      'change financial records',
      'send customer communication',
    ],
    before: (p) =>
      `${text(p['recipientId'])} is set up and held for nobody; ${text(p['embryoId'])} has no recip set aside.`,
    after: (p) =>
      `${text(p['recipientId'])} is held for ${text(p['embryoId'])}, if the clearance rule agrees at approval.`,
  },
  REQUEST_VETERINARY_CONFIRMATION: {
    kind: 'REQUEST_VETERINARY_CONFIRMATION',
    label: 'Request veterinary confirmation',
    executes: 'RequestsService.create — the same row "Send to team" writes',
    approver: 'operations',
    riskClass: 'LOW',
    willNot: [
      'change a pregnancy status',
      'clear the mare',
      'record a clearance or a check',
      'change financial records',
      'send customer communication',
    ],
    before: (p) => `No veterinary request is pending for ${text(p['recipId'])}.`,
    after: (p) => `A request to the vet: “${text(p['subject'])}”.`,
  },
};

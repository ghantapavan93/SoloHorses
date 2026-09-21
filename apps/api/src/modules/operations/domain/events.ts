/** A person decided on a proposal. The review graph that proposed it resumes to its audit row. */
export const OperationsEvents = {
  ProposalDecided: 'ProposalDecided',
} as const;

export interface ProposalDecidedPayload extends Record<string, unknown> {
  proposalId: string;
  kind: string;
  status: 'APPROVED' | 'DECLINED' | 'STALE';
  decision: string;
  decidedBy: string;
  askMessageId: string | null;
}

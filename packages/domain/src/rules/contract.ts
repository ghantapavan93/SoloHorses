/**
 * Breeding contract lifecycle.
 *
 * Money and signature are independent facts; the status is derived from both so it can never
 * disagree with the ledger. Semen leaves the building only from SHIPPABLE.
 */

export type ContractType = 'FRESH_COOLED' | 'FROZEN' | 'ICSI';

export type ContractStatus =
  'RESERVED' | 'DEPOSIT_PAID' | 'SIGNED' | 'PAID_IN_FULL' | 'SHIPPABLE' | 'CLOSED' | 'CANCELLED';

export interface ContractFacts {
  status: ContractStatus;
  depositCents: number;
  studFeeCents: number;
  chuteFeeCents: number;
  /** Sum of SUCCEEDED payments allocated to this contract, in cents. */
  paidCents: number;
  signed: boolean;
}

export function contractTotalCents(
  facts: Pick<ContractFacts, 'depositCents' | 'studFeeCents' | 'chuteFeeCents'>,
): number {
  return facts.depositCents + facts.studFeeCents + facts.chuteFeeCents;
}

export function contractBalanceCents(facts: ContractFacts): number {
  return Math.max(0, contractTotalCents(facts) - facts.paidCents);
}

/**
 * Derive the status a contract should be in from its facts. Terminal states are sticky.
 * Returns the current status unchanged when nothing warrants a move.
 */
export function deriveContractStatus(facts: ContractFacts): ContractStatus {
  if (facts.status === 'CANCELLED' || facts.status === 'CLOSED') return facts.status;

  const paidInFull = facts.paidCents >= contractTotalCents(facts);
  const depositPaid = facts.paidCents >= facts.depositCents && facts.depositCents > 0;

  if (paidInFull && facts.signed) return 'SHIPPABLE';
  if (paidInFull) return 'PAID_IN_FULL';
  if (facts.signed && depositPaid) return 'SIGNED';
  if (depositPaid) return 'DEPOSIT_PAID';
  return 'RESERVED';
}

export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  RESERVED: ['DEPOSIT_PAID', 'SIGNED', 'PAID_IN_FULL', 'CANCELLED'],
  DEPOSIT_PAID: ['SIGNED', 'PAID_IN_FULL', 'SHIPPABLE', 'CANCELLED'],
  SIGNED: ['PAID_IN_FULL', 'SHIPPABLE', 'CANCELLED'],
  PAID_IN_FULL: ['SHIPPABLE', 'CANCELLED', 'CLOSED'],
  SHIPPABLE: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return from === to || CONTRACT_TRANSITIONS[from].includes(to);
}

/** Fresh contracts expire with the season; ICSI contracts are good for one year from purchase. */
export function contractExpiresOn(type: ContractType, season: number, purchasedOn: string): string {
  if (type === 'ICSI') {
    const [y, m, d] = purchasedOn.split('-');
    return `${Number(y) + 1}-${m}-${d}`;
  }
  return `${season}-12-31`;
}

/** What a customer sees on the contract card. Plain language beats legal language. */
export function describeContractStatus(status: ContractStatus): string {
  switch (status) {
    case 'RESERVED':
      return 'Reserved — deposit not yet received.';
    case 'DEPOSIT_PAID':
      return 'Deposit received — contract not yet signed.';
    case 'SIGNED':
      return 'Signed — balance still due before semen can ship.';
    case 'PAID_IN_FULL':
      return 'Paid in full — waiting on signature.';
    case 'SHIPPABLE':
      return 'Paid and signed — semen can ship.';
    case 'CLOSED':
      return 'Closed.';
    case 'CANCELLED':
      return 'Cancelled.';
  }
}

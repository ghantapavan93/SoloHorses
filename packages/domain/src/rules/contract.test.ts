import { describe, expect, it } from 'vitest';
import {
  canTransition,
  contractBalanceCents,
  contractExpiresOn,
  deriveContractStatus,
  type ContractFacts,
} from './contract';

function facts(overrides: Partial<ContractFacts> = {}): ContractFacts {
  return {
    status: 'RESERVED',
    depositCents: 100_000,
    studFeeCents: 650_000,
    chuteFeeCents: 150_000,
    paidCents: 0,
    signed: false,
    ...overrides,
  };
}

describe('deriveContractStatus', () => {
  it('starts reserved with nothing paid', () => {
    expect(deriveContractStatus(facts())).toBe('RESERVED');
  });
  it('moves to DEPOSIT_PAID once the deposit clears', () => {
    expect(deriveContractStatus(facts({ paidCents: 100_000 }))).toBe('DEPOSIT_PAID');
  });
  it('is SIGNED when signed with a deposit but a balance outstanding', () => {
    expect(deriveContractStatus(facts({ paidCents: 100_000, signed: true }))).toBe('SIGNED');
  });
  it('is PAID_IN_FULL when paid but unsigned — semen still cannot ship', () => {
    expect(deriveContractStatus(facts({ paidCents: 900_000 }))).toBe('PAID_IN_FULL');
  });
  it('is SHIPPABLE only when paid in full and signed', () => {
    expect(deriveContractStatus(facts({ paidCents: 900_000, signed: true }))).toBe('SHIPPABLE');
  });
  it('never revives a cancelled contract', () => {
    expect(deriveContractStatus(facts({ status: 'CANCELLED', paidCents: 900_000, signed: true }))).toBe('CANCELLED');
  });
  it('a signature without a deposit is still RESERVED', () => {
    expect(deriveContractStatus(facts({ signed: true }))).toBe('RESERVED');
  });
});

describe('balances and transitions', () => {
  it('computes the outstanding balance', () => {
    expect(contractBalanceCents(facts({ paidCents: 250_000 }))).toBe(650_000);
    expect(contractBalanceCents(facts({ paidCents: 950_000 }))).toBe(0);
  });
  it('allows only forward moves', () => {
    expect(canTransition('RESERVED', 'DEPOSIT_PAID')).toBe(true);
    expect(canTransition('SHIPPABLE', 'RESERVED')).toBe(false);
    expect(canTransition('CLOSED', 'SHIPPABLE')).toBe(false);
  });
  it('expires fresh contracts at season end and ICSI contracts one year out', () => {
    expect(contractExpiresOn('FRESH_COOLED', 2026, '2026-01-15')).toBe('2026-12-31');
    expect(contractExpiresOn('ICSI', 2026, '2026-03-02')).toBe('2027-03-02');
  });
});

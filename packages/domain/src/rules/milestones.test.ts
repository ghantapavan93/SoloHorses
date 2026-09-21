import { describe, expect, it } from 'vitest';
import { FEES } from '../money';
import {
  boardAccruedCents,
  evaluateCheck,
  gestationDay,
  leaseFeeFor,
  nextMilestoneDay,
  type MilestoneContext,
} from './milestones';

function ctx(overrides: Partial<MilestoneContext> = {}): MilestoneContext {
  return {
    checkId: 'CHK-26-0912',
    transferId: 'TR-26-0512',
    embryoId: 'E-26-2041',
    customerId: 'C-0042',
    contractId: 'SS-26-0533',
    contractType: 'ICSI',
    contractStudFeeCents: 450_000,
    embryoSource: 'ICSI',
    embryoWasFrozen: false,
    purchasedEmbryo: false,
    dayNumber: 24,
    result: 'HEARTBEAT',
    performedOn: '2026-04-20',
    alreadyIssued: new Set(),
    ...overrides,
  };
}

describe('lease fee selection', () => {
  it('charges the higher fee for a fresh ICSI embryo', () => {
    expect(leaseFeeFor({ embryoSource: 'ICSI', embryoWasFrozen: false })).toBe(FEES.leaseFeeFreshIcsi);
  });
  it('charges the lower fee for a flush or a thawed embryo', () => {
    expect(leaseFeeFor({ embryoSource: 'FLUSH', embryoWasFrozen: false })).toBe(FEES.leaseFeeFlushOrThawed);
    expect(leaseFeeFor({ embryoSource: 'ICSI', embryoWasFrozen: true })).toBe(FEES.leaseFeeFlushOrThawed);
  });
});

describe('day-24 heartbeat', () => {
  it('creates the lease fee invoice and starts board', () => {
    const out = evaluateCheck(ctx());
    expect(out.invoices).toHaveLength(1);
    expect(out.invoices[0]).toMatchObject({
      kind: 'LEASE_FEE',
      amountCents: 650_000,
      idempotencyKey: 'TR-26-0512:LEASE_FEE',
      triggeredByCheckId: 'CHK-26-0912',
      dueOn: '2026-05-04',
    });
    expect(out.statuses).toContainEqual({
      kind: 'BOARD_STARTS',
      transferId: 'TR-26-0512',
      from: '2026-04-20',
      ratePerDayCents: 2_200,
    });
  });

  it('is idempotent when the lease fee was already issued', () => {
    const out = evaluateCheck(ctx({ alreadyIssued: new Set(['LEASE_FEE']) }));
    expect(out.invoices).toHaveLength(0);
    expect(out.statuses.find((s) => s.kind === 'BOARD_STARTS')).toBeUndefined();
  });

  it('does not bill on a day-14 check', () => {
    const out = evaluateCheck(ctx({ dayNumber: 14, result: 'PREGNANT' }));
    expect(out.invoices).toHaveLength(0);
    expect(out.notes[0]).toMatch(/no billing milestone/);
  });
});

describe('45–60 day window', () => {
  it('bills the ICSI stallion fee for an ICSI contract', () => {
    const out = evaluateCheck(ctx({ dayNumber: 48, result: 'PREGNANT', alreadyIssued: new Set(['LEASE_FEE']) }));
    expect(out.invoices.map((i) => i.kind)).toEqual(['ICSI_STALLION_FEE']);
    expect(out.invoices[0]?.amountCents).toBe(450_000);
  });

  it('does not bill a stallion fee for a fresh-cooled contract', () => {
    const out = evaluateCheck(
      ctx({ dayNumber: 48, result: 'PREGNANT', contractType: 'FRESH_COOLED', alreadyIssued: new Set(['LEASE_FEE']) }),
    );
    expect(out.invoices).toHaveLength(0);
  });

  it('bills both fees if the first positive check lands late, once each', () => {
    const out = evaluateCheck(ctx({ dayNumber: 50, result: 'PREGNANT' }));
    expect(out.invoices.map((i) => i.kind).sort()).toEqual(['ICSI_STALLION_FEE', 'LEASE_FEE']);
    const keys = new Set(out.invoices.map((i) => i.idempotencyKey));
    expect(keys.size).toBe(2);
  });

  it('does not bill outside the window', () => {
    const out = evaluateCheck(ctx({ dayNumber: 61, result: 'PREGNANT', alreadyIssued: new Set(['LEASE_FEE']) }));
    expect(out.invoices).toHaveLength(0);
  });
});

describe('purchased embryo confirmation', () => {
  it('marks confirmed at day 55 without creating an invoice', () => {
    const out = evaluateCheck(
      ctx({
        dayNumber: 55,
        result: 'PREGNANT',
        purchasedEmbryo: true,
        contractType: null,
        contractId: null,
        contractStudFeeCents: null,
        alreadyIssued: new Set(['LEASE_FEE']),
      }),
    );
    expect(out.invoices).toHaveLength(0);
    expect(out.statuses).toContainEqual({ kind: 'EMBRYO_CONFIRMED', embryoId: 'E-26-2041', on: '2026-04-20' });
  });
});

describe('negative and unclear results', () => {
  it('never bills on OPEN, LOST, or UNCLEAR', () => {
    for (const result of ['OPEN', 'LOST', 'UNCLEAR'] as const) {
      const out = evaluateCheck(ctx({ result }));
      expect(out.invoices).toHaveLength(0);
    }
  });
  it('records the remedy on OPEN', () => {
    const out = evaluateCheck(ctx({ result: 'OPEN' }));
    expect(out.statuses[0]).toMatchObject({ kind: 'EMBRYO_OPEN', remedy: 'REDO_OR_CREDIT' });
  });
  it('asks for a recheck on UNCLEAR', () => {
    const out = evaluateCheck(ctx({ result: 'UNCLEAR' }));
    expect(out.statuses[0]).toMatchObject({ kind: 'RECHECK_REQUIRED' });
  });
});

describe('board and gestation helpers', () => {
  it('accrues $22 per day from the heartbeat', () => {
    expect(boardAccruedCents('2026-04-20', '2026-05-20')).toBe(30 * 2_200);
    expect(boardAccruedCents('2026-04-20', '2026-04-20')).toBe(0);
    expect(boardAccruedCents('2026-04-20', '2026-04-10')).toBe(0);
  });
  it('computes gestation day from transfer date and embryo age', () => {
    expect(gestationDay('2026-04-03', '2026-04-20')).toBe(24);
  });
  it('knows the next milestone', () => {
    expect(nextMilestoneDay(14)).toBe(24);
    expect(nextMilestoneDay(24)).toBe(45);
    expect(nextMilestoneDay(150)).toBeNull();
  });
});

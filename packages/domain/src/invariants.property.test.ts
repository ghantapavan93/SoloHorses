import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertCents, cents, formatUsd } from './money';
import { can, canSeeRecord, type Actor, type Resource, type Role } from './rbac';
import { evaluateTransferClearance, type ClearanceRecord } from './rules/clearance';
import { evaluateCheck, type CheckResult, type InvoiceIntentKind, type MilestoneContext } from './rules/milestones';
import {
  PAYMENT_TRANSITIONS,
  paymentTransition,
  providerEventApplies,
  type PaymentStatus,
} from './rules/payment-transitions';
import { evaluateDeparture } from './rules/recip-return';
import {
  evaluateRegistrationRelease,
  fundsState,
  type SettlementInvoice,
  type SettlementPayment,
} from './rules/settlement';
import { stakeFor, sumStakes, type Stake, type StakeKind, type StakeLookups } from './rules/stake';
import { addDays } from './time';

/**
 * The example tests beside each rule say "for this ledger, this verdict". These say "for every
 * ledger the types admit, this never happens": generated inputs, a fixed seed, and a shrunk
 * counterexample when one is found. A failure here is written down as a normal example test
 * beside the rule before the rule is touched.
 */
const SEED = 20260919;
const runs = (numRuns = 400) => ({ seed: SEED, numRuns });

// ───────────────────────────── generators ─────────────────────────────

const PAYMENT_STATUSES: PaymentStatus[] = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'RETURNED',
];
const CLEARED_STATUSES: PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];
const ROLES: Role[] = ['ADMIN', 'STALLION_OFFICE', 'RECIPS', 'VET', 'BILLING', 'CUSTOMER'];
const RESOURCES: Resource[] = [
  'customer',
  'horse',
  'contract',
  'semenOrder',
  'embryo',
  'transfer',
  'check',
  'invoice',
  'payment',
  'accounting',
  'intake',
  'audit',
  'evals',
  'memory',
  'operations',
  'platform',
];

/** Integer cents, never a float: the one representation money has here. */
const centsArb = (max = 5_000_000) => fc.integer({ min: 0, max });
const paymentArb: fc.Arbitrary<SettlementPayment> = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom(...PAYMENT_STATUSES),
  method: fc.constantFrom('CARD', 'ACH', 'CHECK', 'CASH'),
  amountCents: centsArb(),
});
/** A lot always has a price; the zero-amount invoice is a different question (nothing is owed). */
const invoiceArb: fc.Arbitrary<SettlementInvoice> = fc.record({
  id: fc.uuid(),
  amountCents: fc.integer({ min: 1, max: 5_000_000 }),
  status: fc.constantFrom('OPEN', 'PAID', 'DRAFT', 'VOID', 'REFUNDED'),
});
const ledgerArb = fc.array(paymentArb, { maxLength: 8 });

const barnDateArb = fc.integer({ min: -400, max: 400 }).map((d) => addDays('2026-04-20', d));
const clearanceArb = (kinds: ClearanceRecord['kind'][]): fc.Arbitrary<ClearanceRecord> =>
  fc.record({
    id: fc.uuid(),
    kind: fc.constantFrom(...kinds),
    result: fc.constantFrom('CLEAR', 'ABNORMAL', 'PENDING'),
    // Barn dates in a narrow window, so two records land on the same day often enough to matter.
    performedOn: fc.integer({ min: -20, max: 5 }).map((d) => addDays('2026-04-20', d)),
    expiresOn: fc.oneof(
      fc.constant(null),
      fc.integer({ min: -5, max: 40 }).map((d) => addDays('2026-04-20', d)),
    ),
  });

const actorArb: fc.Arbitrary<Actor> = fc.record({
  userId: fc.uuid(),
  role: fc.constantFrom(...ROLES),
  customerId: fc.oneof(fc.constant(null), fc.constantFrom('CUS-1', 'CUS-2', 'CUS-3')),
});
const recordArb = fc.record({ customerId: fc.oneof(fc.constant(null), fc.constantFrom('CUS-1', 'CUS-2', 'CUS-3')) });

const sumWhere = (payments: SettlementPayment[], statuses: PaymentStatus[]) =>
  payments.filter((p) => statuses.includes(p.status)).reduce((sum, p) => sum + p.amountCents, 0);

// ───────────────────────────── 1. money ─────────────────────────────

describe('property · money is integer cents, and a ledger row counts once or not at all', () => {
  it('every two-decimal dollar amount becomes an integer number of cents and formats without loss', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5_000_000_00, max: 5_000_000_00 }), (n) => {
        const amount = cents(n / 100);
        assertCents(amount);
        expect(amount).toBe(n);
        expect(formatUsd(amount)).toMatch(/^-?\$[\d,]+\.\d{2}$/);
      }),
      runs(),
    );
  });

  it('the funds state does not depend on the order the ledger rows come back in', () => {
    fc.assert(
      fc.property(invoiceArb, ledgerArb, fc.infiniteStream(fc.nat()), (invoice, payments, stream) => {
        const shuffled = [...payments];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = (stream.next().value as number) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        expect(fundsState(invoice, shuffled)).toBe(fundsState(invoice, payments));
      }),
      runs(),
    );
  });

  it('a failed, refunded or returned row is not money: adding one never moves a ledger toward cleared', () => {
    const deadArb: fc.Arbitrary<SettlementPayment> = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom('FAILED', 'REFUNDED', 'RETURNED'),
      method: fc.constantFrom('CARD', 'ACH', 'CHECK', 'CASH'),
      amountCents: centsArb(),
    });
    fc.assert(
      fc.property(
        invoiceArb,
        ledgerArb,
        fc.array(deadArb, { minLength: 1, maxLength: 4 }),
        (invoice, payments, dead) => {
          const before = fundsState(invoice, payments);
          const after = fundsState(invoice, [...payments, ...dead]);
          if (before === 'CLEARED' || before === 'PROCESSING' || before === 'PARTIAL') expect(after).toBe(before);
          else expect(['UNPAID', 'FAILED', 'RETURNED']).toContain(after);
        },
      ),
      runs(),
    );
  });
});

// ───────────────────────────── 2. the same dollars once ─────────────────────────────

describe('property · the board counts each obligation once', () => {
  const stakeArb: fc.Arbitrary<Stake> = fc.record({
    amountCents: fc.integer({ min: 1, max: 5_000_000 }),
    label: fc.constantFrom('settlement', 'fee', 'books'),
    exposureKey: fc.constantFrom('invoice:A', 'invoice:B', 'recip-return:R1', 'milestone:E1:24', 'contract:K1'),
  });

  it('two signals about the same dollars add once, the larger figure stands, and order changes nothing', () => {
    fc.assert(
      fc.property(fc.array(stakeArb, { maxLength: 10 }), (stakes) => {
        const total = sumStakes(stakes);
        const largestPerKey = new Map<string, number>();
        for (const s of stakes)
          largestPerKey.set(s.exposureKey, Math.max(largestPerKey.get(s.exposureKey) ?? 0, s.amountCents));
        expect(total).toBe([...largestPerKey.values()].reduce((a, b) => a + b, 0));
        expect(sumStakes([...stakes].reverse())).toBe(total);
        expect(sumStakes([...stakes, ...stakes])).toBe(total);
        expect(total).toBeLessThanOrEqual(stakes.reduce((a, s) => a + s.amountCents, 0));
        assertCents(total);
        expect(total).toBeGreaterThanOrEqual(0);
      }),
      runs(),
    );
  });

  it('an obligation the records price at nothing, or that the records cannot price, holds no stake', () => {
    const detailArb = fc.record({
      invoiceId: fc.constantFrom('INV-1', 'PAY-1', 'INV-none'),
      recipId: fc.constant('R-1'),
      contractId: fc.constantFrom('K-1', 'K-none'),
    });
    fc.assert(
      fc.property(
        fc.constantFrom<StakeKind>(
          'PAPERS_HELD',
          'SETTLEMENT_CONFLICT',
          'PAPERS_RELEASED_FUNDS_RETURNED',
          'ACCOUNTING_SYNC_FAILED',
          'WEBHOOK_FAILED',
          'SHIP_BLOCKED',
          'RETURN_FEE_DECISION',
        ),
        detailArb,
        fc.integer({ min: -100, max: 100_000 }),
        (kind, detail, priced) => {
          const lookups: StakeLookups = {
            invoiceAmountCents: (id) => (id === 'INV-1' ? priced : null),
            paymentAmountCents: (id) => (id === 'PAY-1' ? priced : null),
            paymentInvoiceId: (id) => (id === 'PAY-1' ? 'INV-1' : null),
            embryo: () => null,
            contractBalanceCents: (id) => (id === 'K-1' ? priced : null),
          };
          const stake = stakeFor(kind, detail, detail.invoiceId, lookups);
          if (stake) {
            assertCents(stake.amountCents);
            expect(stake.amountCents).toBeGreaterThan(0);
            expect(stake.exposureKey.length).toBeGreaterThan(0);
          }
          // Priced at zero or below: no stake, never a negative one on the board.
          if (priced <= 0 && kind !== 'RETURN_FEE_DECISION') expect(stake).toBeNull();
          // A payment's exposure is the invoice it pays: the two never count twice.
          if (kind === 'PAPERS_HELD' && detail.invoiceId === 'PAY-1' && stake)
            expect(stake.exposureKey).toBe('invoice:INV-1');
          expect(stakeFor('CHECK_OVERDUE', { milestone: 24 }, null, lookups)).toBeNull();
          expect(stakeFor('NOT_A_KIND', detail, detail.invoiceId, lookups)).toBeNull();
        },
      ),
      runs(),
    );
  });
});

/**
 * The same promise on the billing side: recording a check twice, or two checks past the same
 * milestone, must never bill the same fee twice.
 */
describe('property · a fee is issued once per transfer, whatever sequence of checks arrives', () => {
  const checkArb = fc.record({
    dayNumber: fc.integer({ min: 1, max: 130 }),
    result: fc.constantFrom<CheckResult>('HEARTBEAT', 'PREGNANT', 'OPEN', 'LOST', 'UNCLEAR'),
  });
  const transferArb = fc.record({
    transferId: fc.uuid(),
    embryoId: fc.uuid(),
    customerId: fc.uuid(),
    contractId: fc.oneof(fc.constant(null), fc.uuid()),
    contractType: fc.constantFrom<MilestoneContext['contractType']>('FRESH_COOLED', 'FROZEN', 'ICSI', null),
    contractStudFeeCents: fc.oneof(fc.constant(null), centsArb(1_000_000)),
    embryoSource: fc.constantFrom<MilestoneContext['embryoSource']>('ICSI', 'FLUSH', 'SHIPPED_IN'),
    embryoWasFrozen: fc.boolean(),
    purchasedEmbryo: fc.boolean(),
  });

  it('replaying every check on a transfer, in any order, issues each fee kind at most once with one idempotency key', () => {
    fc.assert(
      fc.property(transferArb, fc.array(checkArb, { minLength: 1, maxLength: 12 }), (transfer, checks) => {
        const issued = new Set<InvoiceIntentKind>();
        const keys = new Map<InvoiceIntentKind, string>();
        checks.forEach((check, i) => {
          const out = evaluateCheck({
            ...transfer,
            checkId: `check-${i}`,
            performedOn: addDays('2026-03-01', check.dayNumber),
            dayNumber: check.dayNumber,
            result: check.result,
            alreadyIssued: issued,
          });
          for (const invoice of out.invoices) {
            expect(issued.has(invoice.kind)).toBe(false);
            expect(keys.get(invoice.kind) ?? invoice.idempotencyKey).toBe(invoice.idempotencyKey);
            expect(invoice.idempotencyKey).toBe(`${transfer.transferId}:${invoice.kind}`);
            assertCents(invoice.amountCents);
            expect(invoice.amountCents).toBeGreaterThanOrEqual(0);
            issued.add(invoice.kind);
            keys.set(invoice.kind, invoice.idempotencyKey);
          }
        });
        // The ledger's dedupe key is the same on a replay: the same check recorded twice cannot bill twice.
        const replay = checks.flatMap(
          (check, i) =>
            evaluateCheck({
              ...transfer,
              checkId: `check-${i}`,
              performedOn: addDays('2026-03-01', check.dayNumber),
              dayNumber: check.dayNumber,
              result: check.result,
              alreadyIssued: issued,
            }).invoices,
        );
        expect(replay).toEqual([]);
      }),
      runs(),
    );
  });
});

// ───────────────────────────── 3. initiated is never cleared ─────────────────────────────

describe('property · initiated is never cleared', () => {
  it('a ledger with no settled row is never CLEARED and never makes the papers eligible', () => {
    const unsettledArb = fc.array(
      paymentArb.filter((p) => !CLEARED_STATUSES.includes(p.status)),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(invoiceArb, unsettledArb, (invoice, payments) => {
        expect(fundsState(invoice, payments)).not.toBe('CLEARED');
        expect(evaluateRegistrationRelease({ id: 'lot', documentId: 'doc' }, invoice, payments).ok).toBe(false);
      }),
      runs(),
    );
  });

  it('the ledger’s word moves one way: returned and refunded are absorbing, and cleared is never un-cleared into pending', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAYMENT_STATUSES),
        fc.array(fc.constantFrom(...PAYMENT_STATUSES), { maxLength: 20 }),
        (start, events) => {
          let status = start;
          let everCleared = CLEARED_STATUSES.includes(start);
          for (const next of events) {
            const before = status;
            if (providerEventApplies('pay', status, next)) status = next;
            if (before === 'RETURNED' || before === 'REFUNDED') expect(status).toBe(before);
            if (everCleared) expect(['PENDING', 'PROCESSING', 'FAILED']).not.toContain(status);
            if (before === 'RETURNED') expect(paymentTransition('pay', before, 'SUCCEEDED').ok).toBe(false);
            everCleared = everCleared || CLEARED_STATUSES.includes(status);
          }
          // The table itself: no status lists a way back to "initiated" from a settled word.
          for (const s of ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'RETURNED'] as PaymentStatus[])
            expect(PAYMENT_TRANSITIONS[s]).not.toContain('PENDING');
        },
      ),
      runs(),
    );
  });
});

// ───────────────────────────── 4. papers ─────────────────────────────

/**
 * Release itself is a person's click in the billing service, outside this package; the domain
 * decides eligibility only. So the half that can be checked here: eligible means the settled
 * rows alone cover the invoice, and every verdict cites what it looked at.
 */
describe('property · papers are eligible only on settled rows, and the verdict cites everything it read', () => {
  it('ok ⇔ CLEARED ⇔ settled rows alone cover the invoice; in-flight money never counts toward eligibility', () => {
    fc.assert(
      fc.property(invoiceArb, ledgerArb, (invoice, payments) => {
        const verdict = evaluateRegistrationRelease({ id: 'lot', documentId: 'doc' }, invoice, payments);
        const settled = sumWhere(payments, CLEARED_STATUSES);
        expect(verdict.ok).toBe(fundsState(invoice, payments) === 'CLEARED');
        expect(verdict.ok).toBe(settled >= invoice.amountCents);
        expect(verdict.evidenceIds).toEqual(
          expect.arrayContaining(['lot', 'doc', invoice.id, ...payments.map((p) => p.id)]),
        );
        if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
      }),
      runs(),
    );
  });
});

// ───────────────────────────── 5. authority ─────────────────────────────

describe('property · authority survives every actor and record shape', () => {
  it('only a vet or an admin writes a check; only billing or an admin writes money; a customer writes nothing but memory', () => {
    fc.assert(
      fc.property(actorArb, fc.constantFrom(...RESOURCES), (actor, resource) => {
        const writes = can(actor, 'write', resource);
        if (resource === 'check' && writes) expect(['VET', 'ADMIN']).toContain(actor.role);
        if (['invoice', 'payment', 'accounting'].includes(resource) && writes)
          expect(['BILLING', 'ADMIN']).toContain(actor.role);
        if (actor.role === 'CUSTOMER' && writes) expect(resource).toBe('memory');
        if (actor.role === 'CUSTOMER')
          expect(
            can(actor, 'read', 'operations') || can(actor, 'read', 'audit') || can(actor, 'read', 'platform'),
          ).toBe(false);
        // Writing implies reading: no role acts on a record it may not see.
        if (writes) expect(can(actor, 'read', resource)).toBe(true);
      }),
      runs(),
    );
  });

  it('a customer sees a row only when it carries their own id — never on a null, never on another’s', () => {
    fc.assert(
      fc.property(
        actorArb.filter((a) => a.role === 'CUSTOMER'),
        fc.constantFrom(...RESOURCES),
        recordArb,
        (actor, resource, record) => {
          const sees = canSeeRecord(actor, resource, record);
          if (sees) {
            expect(actor.customerId).not.toBeNull();
            expect(record.customerId).toBe(actor.customerId);
          }
          if (actor.customerId === null || record.customerId === null || record.customerId !== actor.customerId)
            expect(sees).toBe(false);
        },
      ),
      runs(),
    );
  });

  it('a veterinary verdict depends on the records, never on the order they come back in', () => {
    fc.assert(
      fc.property(
        fc.array(clearanceArb(['PRE_TRANSFER_EXAM', 'UTERINE_CULTURE', 'VIDEO_IN_FOAL']), { maxLength: 6 }),
        barnDateArb,
        (clearances, today) => {
          const reversed = [...clearances].reverse();
          const transfer = evaluateTransferClearance({ id: 'recip', clearances }, today);
          expect(evaluateTransferClearance({ id: 'recip', clearances: reversed }, today)).toEqual(transfer);
          const departure = evaluateDeparture(
            { id: 'recip', scheduledDepartureOn: addDays(today, 2), clearances },
            today,
          );
          expect(
            evaluateDeparture({ id: 'recip', scheduledDepartureOn: addDays(today, 2), clearances: reversed }, today),
          ).toEqual(departure);
        },
      ),
      runs(),
    );
  });

  it('an abnormal result on the latest day never clears a mare for a transfer', () => {
    fc.assert(
      fc.property(
        fc.array(clearanceArb(['PRE_TRANSFER_EXAM', 'UTERINE_CULTURE']), { minLength: 1, maxLength: 6 }),
        barnDateArb,
        (clearances, today) => {
          const verdict = evaluateTransferClearance({ id: 'recip', clearances }, today);
          for (const kind of ['PRE_TRANSFER_EXAM', 'UTERINE_CULTURE'] as const) {
            const ofKind = clearances.filter((c) => c.kind === kind);
            const latestDay = ofKind
              .map((c) => c.performedOn)
              .sort()
              .at(-1);
            if (ofKind.some((c) => c.performedOn === latestDay && c.result === 'ABNORMAL'))
              expect(verdict.ok).toBe(false);
          }
        },
      ),
      runs(),
    );
  });
});

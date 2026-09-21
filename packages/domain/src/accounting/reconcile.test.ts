import { describe, expect, it } from 'vitest';
import { reconcile, type ReconcileInput } from './reconcile';

function base(): ReconcileInput {
  return {
    localInvoices: [{ id: 'INV-26-1093', customerId: 'C-0042', amountCents: 650_000, status: 'PAID' }],
    localPayments: [
      {
        id: 'PAY-26-0451',
        invoiceId: 'INV-26-1093',
        customerId: 'C-0042',
        amountCents: 650_000,
        status: 'SUCCEEDED',
        refundedCents: 0,
      },
    ],
    remoteInvoices: [
      {
        externalId: 'qbo-inv-1',
        docNumber: 'INV-26-1093',
        customerExternalId: 'qbo-cust-42',
        totalCents: 650_000,
        balanceCents: 0,
        syncToken: '1',
      },
    ],
    remotePayments: [
      {
        externalId: 'qbo-pay-1',
        referenceNumber: 'PAY-26-0451',
        customerExternalId: 'qbo-cust-42',
        totalCents: 650_000,
        linkedInvoiceExternalIds: ['qbo-inv-1'],
        syncToken: '0',
      },
    ],
    customerMap: new Map([['C-0042', 'qbo-cust-42']]),
    invoiceMap: new Map([['INV-26-1093', 'qbo-inv-1']]),
  };
}

describe('reconcile', () => {
  it('reports in-sync when both sides agree', () => {
    const r = reconcile(base());
    expect(r.findings).toEqual([]);
    expect(r.inSync).toEqual({ invoices: ['INV-26-1093'], payments: ['PAY-26-0451'] });
  });

  it('flags an amount mismatch with the direction of the difference', () => {
    const input = base();
    input.remoteInvoices[0]!.totalCents = 500_000;
    const r = reconcile(input);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      kind: 'AMOUNT_MISMATCH',
      entityId: 'INV-26-1093',
      explanation: 'INV-26-1093 is $1500.00 lower in the books.',
    });
  });

  it('flags a payment that reached the books but is not applied to its invoice', () => {
    const input = base();
    input.remotePayments[0]!.linkedInvoiceExternalIds = [];
    const r = reconcile(input);
    expect(r.findings[0]).toMatchObject({ kind: 'UNLINKED_PAYMENT', entityId: 'PAY-26-0451' });
  });

  it('flags missing on either side', () => {
    const input = base();
    input.remoteInvoices = [];
    input.remotePayments = [];
    input.remoteInvoices.push({
      externalId: 'qbo-inv-9',
      docNumber: 'INV-26-9999',
      customerExternalId: 'qbo-cust-42',
      totalCents: 100,
      balanceCents: 100,
      syncToken: '0',
    });
    const r = reconcile(input);
    expect(r.findings.map((f) => f.kind).sort()).toEqual(['MISSING_LOCAL', 'MISSING_REMOTE', 'MISSING_REMOTE']);
  });

  it('compares net of refunds for payments', () => {
    const input = base();
    input.localPayments[0]!.refundedCents = 50_000;
    input.localPayments[0]!.status = 'PARTIALLY_REFUNDED';
    input.remotePayments[0]!.totalCents = 600_000;
    expect(reconcile(input).findings).toEqual([]);
  });

  it('ignores drafts and voids', () => {
    const input = base();
    input.localInvoices.push({ id: 'INV-26-2000', customerId: 'C-0042', amountCents: 1, status: 'VOID' });
    expect(reconcile(input).findings).toEqual([]);
  });
});

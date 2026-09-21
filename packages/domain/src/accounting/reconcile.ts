/**
 * Reconciliation between the operational ledger (Stripe is the cash truth) and the books
 * (the accounting system). Pure comparison; the caller fetches both sides.
 *
 * States:
 *   IN_SYNC   — same customer, same amount, payment linked to the invoice
 *   PENDING   — we have not pushed it yet (or the push is in flight)
 *   MISMATCH  — both sides exist and disagree
 *   ORPHANED  — one side exists without the other
 *
 * Every MISMATCH/ORPHANED becomes a Discrepancy row that a person resolves.
 */

export interface LocalInvoice {
  id: string;
  customerId: string;
  amountCents: number;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED';
}

export interface LocalPayment {
  id: string;
  invoiceId: string | null;
  customerId: string;
  amountCents: number;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'RETURNED';
  refundedCents: number;
}

export interface RemoteInvoice {
  externalId: string;
  docNumber: string; // our invoice id, as pushed
  customerExternalId: string;
  totalCents: number;
  balanceCents: number;
  syncToken: string;
}

export interface RemotePayment {
  externalId: string;
  referenceNumber: string; // our payment id, as pushed (≤ 21 chars)
  customerExternalId: string;
  totalCents: number;
  linkedInvoiceExternalIds: string[];
  syncToken: string;
}

export type DiscrepancyKind =
  'AMOUNT_MISMATCH' | 'CUSTOMER_MISMATCH' | 'MISSING_REMOTE' | 'MISSING_LOCAL' | 'UNLINKED_PAYMENT' | 'SYNC_FAILED';

export interface Finding {
  kind: DiscrepancyKind;
  entityType: 'INVOICE' | 'PAYMENT';
  entityId: string;
  localValue: unknown;
  remoteValue: unknown;
  explanation: string;
}

export interface ReconcileInput {
  localInvoices: LocalInvoice[];
  localPayments: LocalPayment[];
  remoteInvoices: RemoteInvoice[];
  remotePayments: RemotePayment[];
  /** Map of our customer id → accounting customer id. */
  customerMap: ReadonlyMap<string, string>;
  /** Map of our invoice id → accounting invoice id. */
  invoiceMap: ReadonlyMap<string, string>;
}

export interface ReconcileResult {
  findings: Finding[];
  inSync: { invoices: string[]; payments: string[] };
}

/** Accounting reference fields are short; a Stripe id does not fit. We push our own codes. */
export const REMOTE_REF_MAX_LENGTH = 21;

export function reconcile(input: ReconcileInput): ReconcileResult {
  const findings: Finding[] = [];
  const inSync = { invoices: [] as string[], payments: [] as string[] };

  const remoteInvoiceByDoc = new Map(input.remoteInvoices.map((r) => [r.docNumber, r]));
  const remotePaymentByRef = new Map(input.remotePayments.map((r) => [r.referenceNumber, r]));

  for (const inv of input.localInvoices) {
    if (inv.status === 'DRAFT' || inv.status === 'VOID') continue;
    const remote = remoteInvoiceByDoc.get(inv.id);
    if (!remote) {
      findings.push({
        kind: 'MISSING_REMOTE',
        entityType: 'INVOICE',
        entityId: inv.id,
        localValue: { amountCents: inv.amountCents, status: inv.status },
        remoteValue: null,
        explanation: `${inv.id} exists locally but not in the books.`,
      });
      continue;
    }
    const expectedCustomer = input.customerMap.get(inv.customerId);
    if (expectedCustomer && remote.customerExternalId !== expectedCustomer) {
      findings.push({
        kind: 'CUSTOMER_MISMATCH',
        entityType: 'INVOICE',
        entityId: inv.id,
        localValue: { customerExternalId: expectedCustomer },
        remoteValue: { customerExternalId: remote.customerExternalId },
        explanation: `${inv.id} is filed under a different customer in the books.`,
      });
      continue;
    }
    if (remote.totalCents !== inv.amountCents) {
      findings.push({
        kind: 'AMOUNT_MISMATCH',
        entityType: 'INVOICE',
        entityId: inv.id,
        localValue: { amountCents: inv.amountCents },
        remoteValue: { amountCents: remote.totalCents },
        explanation: `${inv.id} is ${formatDelta(inv.amountCents, remote.totalCents)} in the books.`,
      });
      continue;
    }
    inSync.invoices.push(inv.id);
  }

  for (const remote of input.remoteInvoices) {
    if (!input.localInvoices.some((l) => l.id === remote.docNumber)) {
      findings.push({
        kind: 'MISSING_LOCAL',
        entityType: 'INVOICE',
        entityId: remote.docNumber,
        localValue: null,
        remoteValue: { externalId: remote.externalId, totalCents: remote.totalCents },
        explanation: `Books contain invoice ${remote.docNumber} that does not exist here.`,
      });
    }
  }

  for (const pay of input.localPayments) {
    if (
      pay.status !== 'SUCCEEDED' &&
      pay.status !== 'PARTIALLY_REFUNDED' &&
      pay.status !== 'REFUNDED' &&
      pay.status !== 'RETURNED'
    )
      continue;
    const remote = remotePaymentByRef.get(pay.id);
    // A returned debit that never reached the books has nothing to reconcile; one that did is a receipt the books must not keep.
    if (pay.status === 'RETURNED' && !remote) continue;
    if (!remote) {
      findings.push({
        kind: 'MISSING_REMOTE',
        entityType: 'PAYMENT',
        entityId: pay.id,
        localValue: { amountCents: pay.amountCents, invoiceId: pay.invoiceId },
        remoteValue: null,
        explanation: `${pay.id} settled but has not reached the books.`,
      });
      continue;
    }
    const netCents = pay.status === 'RETURNED' ? 0 : pay.amountCents - pay.refundedCents;
    if (remote.totalCents !== netCents) {
      findings.push({
        kind: 'AMOUNT_MISMATCH',
        entityType: 'PAYMENT',
        entityId: pay.id,
        localValue: { netCents },
        remoteValue: { totalCents: remote.totalCents },
        explanation: `${pay.id} is ${formatDelta(netCents, remote.totalCents)} in the books.`,
      });
      continue;
    }
    if (pay.invoiceId) {
      const remoteInvoiceId = input.invoiceMap.get(pay.invoiceId);
      if (!remoteInvoiceId || !remote.linkedInvoiceExternalIds.includes(remoteInvoiceId)) {
        findings.push({
          kind: 'UNLINKED_PAYMENT',
          entityType: 'PAYMENT',
          entityId: pay.id,
          localValue: { invoiceId: pay.invoiceId },
          remoteValue: { linkedInvoiceExternalIds: remote.linkedInvoiceExternalIds },
          explanation: `${pay.id} is in the books but not applied to ${pay.invoiceId}.`,
        });
        continue;
      }
    }
    inSync.payments.push(pay.id);
  }

  return { findings, inSync };
}

function formatDelta(localCents: number, remoteCents: number): string {
  const diff = remoteCents - localCents;
  const dollars = (Math.abs(diff) / 100).toFixed(2);
  return diff > 0 ? `$${dollars} higher` : `$${dollars} lower`;
}

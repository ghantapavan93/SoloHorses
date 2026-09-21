/**
 * The port between our ledger and an accounting system. QuickBooks Online is the first
 * adapter; the simulator is the second. Services depend on this interface only.
 *
 * Money crosses this boundary as integer cents and is converted to the provider's decimal
 * dollars at the edge, never before.
 */

export interface RemoteCustomer {
  id: string;
  displayName: string;
  syncToken: string;
}

export interface RemoteItem {
  id: string;
  name: string;
}

export interface RemoteInvoice {
  id: string;
  docNumber: string;
  customerId: string;
  totalCents: number;
  balanceCents: number;
  syncToken: string;
  txnDate: string;
  dueDate: string;
}

export interface RemotePayment {
  id: string;
  referenceNumber: string;
  customerId: string;
  totalCents: number;
  linkedInvoiceIds: string[];
  syncToken: string;
  txnDate: string;
}

export interface RemoteCredit {
  id: string;
  docNumber: string;
  customerId: string;
  totalCents: number;
  syncToken: string;
}

export interface CreateCustomerInput {
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface CreateInvoiceInput {
  docNumber: string; // our invoice code, ≤ 21 chars
  customerId: string; // remote customer id
  itemId: string;
  description: string;
  amountCents: number;
  txnDate: string; // YYYY-MM-DD
  dueDate: string;
}

export interface CreatePaymentInput {
  referenceNumber: string; // our payment code, ≤ 21 chars
  customerId: string;
  amountCents: number;
  txnDate: string;
  linkedInvoiceId: string | null;
}

export interface CreateCreditInput {
  docNumber: string; // our refund code
  customerId: string;
  itemId: string;
  amountCents: number;
  txnDate: string;
  description: string;
}

export interface AccountingProvider {
  readonly mode: 'live' | 'simulated';
  readonly label: string;
  findCustomerByName(displayName: string): Promise<RemoteCustomer | null>;
  createCustomer(input: CreateCustomerInput): Promise<RemoteCustomer>;
  ensureItem(name: string): Promise<RemoteItem>;
  findInvoiceByDocNumber(docNumber: string): Promise<RemoteInvoice | null>;
  createInvoice(input: CreateInvoiceInput): Promise<RemoteInvoice>;
  updateInvoiceAmount(id: string, syncToken: string, amountCents: number): Promise<RemoteInvoice>;
  findPaymentByReference(referenceNumber: string): Promise<RemotePayment | null>;
  createPayment(input: CreatePaymentInput): Promise<RemotePayment>;
  findCreditByDocNumber(docNumber: string): Promise<RemoteCredit | null>;
  createCredit(input: CreateCreditInput): Promise<RemoteCredit>;
  /** For reconciliation: every invoice and payment the books hold for our doc numbers. */
  listInvoices(docNumbers: string[]): Promise<RemoteInvoice[]>;
  listPayments(referenceNumbers: string[]): Promise<RemotePayment[]>;
}

/** Provider asked us to slow down. Carries how long the queue should pause. */
export class AccountingRateLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    readonly requestId: string | null,
  ) {
    super(`accounting provider rate limited; retry after ${retryAfterMs}ms`);
  }
}

/** Token expired or revoked; the connection must be refreshed or re-authorized. */
export class AccountingAuthError extends Error {}

/** The provider rejected the request as malformed or conflicting (e.g. stale SyncToken). Not retryable as-is. */
export class AccountingValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

/** Transient upstream failure; retry with backoff. */
export class AccountingTransientError extends Error {
  constructor(
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

export const ACCOUNTING_PROVIDER = Symbol('ACCOUNTING_PROVIDER');

export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

export function decimalToCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/** QBO reference fields are 21 characters; our codes fit, Stripe ids do not. */
export function assertReferenceLength(value: string): string {
  if (value.length > 21)
    throw new AccountingValidationError('REF_TOO_LONG', `${value} exceeds the 21-character reference limit`, null);
  return value;
}

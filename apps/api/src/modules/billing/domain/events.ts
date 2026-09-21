import type { PaymentMethod, PaymentStatus } from '@daysheet/db';

/**
 * What billing tells the rest of the operation, in its own words. Consumers — accounting,
 * reproduction, operations — decide what each fact means to them; billing does not know
 * who listens.
 */
export const BillingEvents = {
  PaymentSucceeded: 'PaymentSucceeded',
  PaymentProcessing: 'PaymentProcessing',
  PaymentFailed: 'PaymentFailed',
  PaymentRefunded: 'PaymentRefunded',
  /** The bank pulled a settled ACH debit back. Not a refund: nobody here chose it. */
  PaymentReturned: 'PaymentReturned',
  InvoicePaid: 'InvoicePaid',
  /** The release rule said a held registration certificate may go. Said, not sent: a person sends it. */
  DocumentEligible: 'DocumentEligible',
  /** A lot sold on the vendor's platform is now a sale here: an invoice, a payment in flight, a certificate to hold. */
  LotSold: 'LotSold',
} as const;

export interface LotSoldPayload extends Record<string, unknown> {
  lotId: string;
  invoiceId: string;
  paymentId: string | null;
  documentId: string | null;
  buyerId: string;
  hammerCents: number;
  simulated: boolean;
}

export interface PaymentEventPayload extends Record<string, unknown> {
  paymentId: string;
  invoiceId: string | null;
  customerId: string;
  contractId: string | null;
  amountCents: number;
  refundedCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  simulated: boolean;
}

export interface InvoicePaidPayload extends Record<string, unknown> {
  invoiceId: string;
  customerId: string;
  contractId: string | null;
  amountCents: number;
}

export interface DocumentEligiblePayload extends Record<string, unknown> {
  documentId: string;
  lotId: string;
  invoiceId: string;
  policy: string;
}

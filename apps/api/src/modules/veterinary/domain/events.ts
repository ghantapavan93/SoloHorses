import type { CheckResult, ClearanceKind, ClearanceResult, EmbryoStatus, InvoiceKind } from '@daysheet/db';

/** The vet records what the scan showed; the fact goes out in the barn's words. */
export const VeterinaryEvents = {
  CheckRecorded: 'CheckRecorded',
  MilestoneInvoiced: 'MilestoneInvoiced',
  /** A clearance on a mare: exam, culture, the video before she leaves, the assessment when she is back. */
  ClearanceRecorded: 'ClearanceRecorded',
} as const;

export interface ClearanceRecordedPayload extends Record<string, unknown> {
  clearanceId: string;
  horseId: string;
  kind: ClearanceKind;
  result: ClearanceResult;
  performedOn: string;
}

export interface CheckRecordedPayload extends Record<string, unknown> {
  checkId: string;
  transferId: string;
  embryoId: string;
  recipientId: string;
  customerId: string;
  dayNumber: number;
  result: CheckResult;
  embryoStatus: EmbryoStatus;
  performedOn: string;
}

export interface MilestoneInvoicedPayload extends Record<string, unknown> {
  invoiceId: string;
  kind: InvoiceKind;
  amountCents: number;
  customerId: string;
  contractId: string | null;
  embryoId: string | null;
  triggeredByCheckId: string;
}

import type { ContractStatus, EmbryoSource } from '@daysheet/db';

/** Reproduction speaks of embryos, recips and contracts. */
export const ReproductionEvents = {
  EmbryoExpected: 'EmbryoExpected',
  IntakeConfirmed: 'IntakeConfirmed',
  ContractStatusChanged: 'ContractStatusChanged',
  HorseUpdated: 'HorseUpdated',
  PlannedRecipientAssigned: 'PlannedRecipientAssigned',
  TransferRecorded: 'TransferRecorded',
  /** A second or later implant attempt was invoiced under the lease's published fee. */
  ImplantFeeInvoiced: 'ImplantFeeInvoiced',
} as const;

export interface ImplantFeeInvoicedPayload extends Record<string, unknown> {
  invoiceId: string;
  transferId: string;
  embryoId: string;
  customerId: string;
  attempt: number;
  amountCents: number;
}

export interface EmbryoExpectedPayload extends Record<string, unknown> {
  embryoId: string;
  customerId: string;
  source: EmbryoSource;
  expectedOn: string | null;
  plannedRecipientId: string | null;
  intakeMessageId: string | null;
}

export interface IntakeConfirmedPayload extends Record<string, unknown> {
  messageId: string;
  customerId: string;
  embryoIds: string[];
  replyMessageId: string | null;
}

export interface ContractStatusChangedPayload extends Record<string, unknown> {
  contractId: string;
  customerId: string;
  from: ContractStatus;
  to: ContractStatus;
  ordersReleased: number;
  causedByPaymentId: string | null;
}

export interface HorseUpdatedPayload extends Record<string, unknown> {
  horseId: string;
  fields: string[];
}

export interface PlannedRecipientAssignedPayload extends Record<string, unknown> {
  embryoId: string;
  recipId: string;
  previousRecipId: string | null;
  evidenceIds: string[];
}

export interface TransferRecordedPayload extends Record<string, unknown> {
  transferId: string;
  embryoId: string;
  recipientId: string;
  customerId: string;
  performedOn: string;
  clearanceEvidenceIds: string[];
}

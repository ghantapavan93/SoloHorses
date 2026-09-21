import type { ExceptionKind } from '@daysheet/db';

/**
 * A signal is an exception seen from the front door: one line, a channel, who acts next, and
 * the same id and correlation id it carries everywhere else. The ring on the landing, the dock
 * in the corner and the board are one list wearing three coats.
 */
export type SignalChannel = 'SALE' | 'RECIPIENT' | 'REPRODUCTION' | 'ACCOUNTING' | 'VETERINARY' | 'SYSTEM';

export interface SignalShape {
  channel: SignalChannel;
  /** The office's name for the channel. */
  channelLabel: string;
  /** Who acts next, in two or three words. */
  next: string;
  /** Which role owns the next step. */
  owner: 'BILLING' | 'VET' | 'RECIPS' | 'STALLION_OFFICE' | 'ADMIN';
  /** Where the next step lives on the web; the page decides the exact href. */
  surface: 'settlement' | 'returns' | 'story' | 'operations' | 'money' | 'intake';
}

export const SIGNAL_SHAPES: Record<ExceptionKind, SignalShape> = {
  PAPERS_HELD: {
    channel: 'SALE',
    channelLabel: 'Sale settlement',
    next: 'Hold papers',
    owner: 'BILLING',
    surface: 'settlement',
  },
  SETTLEMENT_CONFLICT: {
    channel: 'SALE',
    channelLabel: 'Sale settlement',
    next: 'Billing review',
    owner: 'BILLING',
    surface: 'settlement',
  },
  PAPERS_RELEASED_FUNDS_RETURNED: {
    channel: 'SALE',
    channelLabel: 'Sale settlement',
    next: 'Call the buyer today',
    owner: 'BILLING',
    surface: 'settlement',
  },
  RETURN_ASSESSMENT_MISSING: {
    channel: 'RECIPIENT',
    channelLabel: 'Recipient return',
    next: 'Route to vet',
    owner: 'VET',
    surface: 'returns',
  },
  RETURN_FEE_DECISION: {
    channel: 'RECIPIENT',
    channelLabel: 'Recipient return',
    next: 'Billing decides',
    owner: 'BILLING',
    surface: 'returns',
  },
  DEPARTURE_UNCONFIRMED: {
    channel: 'VETERINARY',
    channelLabel: 'Recipient leaving',
    next: 'Route to vet',
    owner: 'VET',
    surface: 'story',
  },
  RECIPIENT_MISSING: {
    channel: 'REPRODUCTION',
    channelLabel: 'Reproduction handoff',
    next: 'Set a recip aside',
    owner: 'RECIPS',
    surface: 'operations',
  },
  RECIPIENT_CONFLICT: {
    channel: 'REPRODUCTION',
    channelLabel: 'Reproduction handoff',
    next: 'Pick another mare',
    owner: 'RECIPS',
    surface: 'story',
  },
  CLEARANCE_MISSING: {
    channel: 'REPRODUCTION',
    channelLabel: 'Reproduction handoff',
    next: 'Route to vet',
    owner: 'VET',
    surface: 'operations',
  },
  CHECK_OVERDUE: {
    channel: 'VETERINARY',
    channelLabel: 'Veterinary',
    next: 'Record the check',
    owner: 'VET',
    surface: 'story',
  },
  CONFLICTING_RECORD: {
    channel: 'VETERINARY',
    channelLabel: 'Veterinary',
    next: 'Vet decides',
    owner: 'VET',
    surface: 'operations',
  },
  ACCOUNTING_SYNC_FAILED: {
    channel: 'ACCOUNTING',
    channelLabel: 'Accounting',
    next: 'Retry the sync',
    owner: 'BILLING',
    surface: 'money',
  },
  RECONCILIATION_MISMATCH: {
    channel: 'ACCOUNTING',
    channelLabel: 'Accounting',
    next: 'Pick the right side',
    owner: 'BILLING',
    surface: 'money',
  },
  INTEGRATION_DEGRADED: {
    channel: 'ACCOUNTING',
    channelLabel: 'Accounting',
    next: 'Wait for the probe',
    owner: 'ADMIN',
    surface: 'money',
  },
  WEBHOOK_FAILED: {
    channel: 'ACCOUNTING',
    channelLabel: 'Payments',
    next: 'Match the event',
    owner: 'BILLING',
    surface: 'money',
  },
  SHIP_BLOCKED: {
    channel: 'SYSTEM',
    channelLabel: 'Stallion office',
    next: 'Collect or hold',
    owner: 'STALLION_OFFICE',
    surface: 'operations',
  },
  INTAKE_UNCONFIRMED: {
    channel: 'REPRODUCTION',
    channelLabel: 'Intake',
    next: 'Confirm the text',
    owner: 'RECIPS',
    surface: 'intake',
  },
  JOB_DEAD_LETTERED: {
    channel: 'SYSTEM',
    channelLabel: 'Systems',
    next: 'Retry the job',
    owner: 'ADMIN',
    surface: 'operations',
  },
};

/** The four the front door shows first, in the order a founder meets them. */
export const RING_CHANNELS: SignalChannel[] = ['SALE', 'RECIPIENT', 'REPRODUCTION', 'ACCOUNTING'];

/** Within a channel, the kind a reviewer can act on from the front door comes first. */
export const RING_PREFERENCE: Partial<Record<SignalChannel, ExceptionKind[]>> = {
  SALE: ['PAPERS_RELEASED_FUNDS_RETURNED', 'PAPERS_HELD', 'SETTLEMENT_CONFLICT'],
  RECIPIENT: ['RETURN_ASSESSMENT_MISSING', 'RETURN_FEE_DECISION'],
  REPRODUCTION: ['RECIPIENT_MISSING', 'CLEARANCE_MISSING', 'RECIPIENT_CONFLICT', 'INTAKE_UNCONFIRMED'],
  ACCOUNTING: ['ACCOUNTING_SYNC_FAILED', 'WEBHOOK_FAILED', 'RECONCILIATION_MISMATCH', 'INTEGRATION_DEGRADED'],
};

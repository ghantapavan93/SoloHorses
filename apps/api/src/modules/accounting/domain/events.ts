import type { DiscrepancyKind, DiscrepancyResolution, MappedEntityType } from '@daysheet/db';

/** Accounting speaks in terms of the books: pushed, in disagreement, resolved. */
export const AccountingEvents = {
  EntitySynced: 'EntitySynced',
  DiscrepancyRaised: 'DiscrepancyRaised',
  DiscrepancyResolved: 'DiscrepancyResolved',
} as const;

export interface EntitySyncedPayload extends Record<string, unknown> {
  entityType: MappedEntityType;
  entityId: string;
  externalId: string;
  attempt: number;
}

export interface DiscrepancyRaisedPayload extends Record<string, unknown> {
  discrepancyId: string;
  kind: DiscrepancyKind;
  entityType: MappedEntityType;
  entityId: string;
  localValue: unknown;
  remoteValue: unknown;
}

export interface DiscrepancyResolvedPayload extends Record<string, unknown> {
  discrepancyId: string;
  resolution: DiscrepancyResolution;
  resolvedBy: string;
}

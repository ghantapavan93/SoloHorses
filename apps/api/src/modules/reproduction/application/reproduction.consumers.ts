import { Injectable, type OnModuleInit } from '@nestjs/common';
import { deriveContractStatus } from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { appendDomainEvent, type DomainEventRecord } from '../../../platform/events/domain-event';
import { EventDispatcher } from '../../../platform/events/event-dispatcher';
import { CacheService } from '../../../platform/cache/cache.service';
import { BillingEvents, type InvoicePaidPayload, type PaymentEventPayload } from '../../billing/domain/events';
import {
  VeterinaryEvents,
  type CheckRecordedPayload,
  type ClearanceRecordedPayload,
} from '../../veterinary/domain/events';
import { ReproductionEvents, type ContractStatusChangedPayload, type HorseUpdatedPayload } from '../domain/events';
import { horseCacheKey } from './records.service';

/**
 * Billing says money moved; reproduction decides what that means for the contract and
 * the collection sheet: a settled balance on a signed contract makes it shippable and
 * releases orders that were holding for payment. Billing never touches a contract.
 *
 * The rule itself (deriveContractStatus) lives in the domain package; this consumer only
 * re-reads the ledger and applies the answer in one transaction with its audit row.
 */
@Injectable()
export class ReproductionConsumers implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({
      name: 'reproduction.contract-status',
      events: [BillingEvents.PaymentSucceeded, BillingEvents.PaymentRefunded, BillingEvents.InvoicePaid],
      handle: async (
        event: DomainEventRecord<PaymentEventPayload | InvoicePaidPayload>,
        tx: Prisma.TransactionClient,
      ) => {
        const contractId = event.payload.contractId;
        if (!contractId) return;
        await recomputeContract(
          tx,
          this.audit,
          contractId,
          'paymentId' in event.payload ? String(event.payload.paymentId) : null,
        );
      },
    });

    // Domain invalidation is the rule; the TTL on the entry is only the safety net.
    this.dispatcher.register({
      name: 'reproduction.horse-cache',
      events: [ReproductionEvents.HorseUpdated, VeterinaryEvents.CheckRecorded, VeterinaryEvents.ClearanceRecorded],
      handle: async (
        event: DomainEventRecord<HorseUpdatedPayload | CheckRecordedPayload | ClearanceRecordedPayload>,
      ) => {
        const horseId = String('horseId' in event.payload ? event.payload.horseId : event.payload.recipientId);
        await this.cache.invalidate(horseCacheKey(horseId));
      },
    });
  }
}

export async function recomputeContract(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  contractId: string,
  causedByPaymentId: string | null,
): Promise<void> {
  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    include: { invoices: { include: { payments: true } } },
  });
  if (!contract) return;
  const paidCents = contract.invoices
    .flatMap((i) => i.payments)
    .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
    .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
  const next = deriveContractStatus({
    status: contract.status,
    depositCents: contract.depositCents,
    studFeeCents: contract.studFeeCents,
    chuteFeeCents: contract.chuteFeeCents,
    paidCents,
    signed: contract.signedAt !== null,
  });
  if (next === contract.status) return;
  await tx.contract.update({ where: { id: contract.id }, data: { status: next } });
  const flipped =
    next === 'SHIPPABLE'
      ? await tx.semenOrder.updateMany({
          where: { contractId: contract.id, status: 'HOLD_UNPAID' },
          data: { status: 'SCHEDULED' },
        })
      : { count: 0 };
  await audit.record(
    {
      actor: null,
      source: 'JOB',
      action: 'contract.status',
      entityType: 'Contract',
      entityId: contract.id,
      before: { status: contract.status },
      after: { status: next, ordersReleased: flipped.count, causedByPaymentId },
    },
    tx,
  );
  const payload: ContractStatusChangedPayload = {
    contractId: contract.id,
    customerId: contract.customerId,
    from: contract.status,
    to: next,
    ordersReleased: flipped.count,
    causedByPaymentId,
  };
  await appendDomainEvent(tx, {
    aggregateType: 'Contract',
    aggregateId: contract.id,
    type: ReproductionEvents.ContractStatusChanged,
    payload,
  });
}

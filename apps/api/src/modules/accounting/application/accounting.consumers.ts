import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@daysheet/db';
import { type DomainEventRecord } from '../../../platform/events/domain-event';
import { EventDispatcher } from '../../../platform/events/event-dispatcher';
import { JobsService } from '../../../platform/queue/jobs.service';
import { BillingEvents, type InvoicePaidPayload, type PaymentEventPayload } from '../../billing/domain/events';

/**
 * Billing says a payment succeeded; accounting decides that means a payment document and a
 * paid invoice in the books. The sync jobs are written to the ledger inside the consumer's
 * transaction (same transaction as the processed-event row), so the intent to sync can no
 * more be lost than the fact that caused it.
 */
@Injectable()
export class AccountingConsumers implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({
      name: 'accounting.sync-paid-invoice',
      events: [BillingEvents.InvoicePaid],
      handle: async (event: DomainEventRecord<InvoicePaidPayload>, tx: Prisma.TransactionClient) => {
        await this.jobs.enqueue(
          'qbo-sync',
          { entityType: 'INVOICE', entityId: event.payload.invoiceId, reason: 'paid' },
          { jobId: `qbo_INVOICE_${event.payload.invoiceId}_paid`, tx },
        );
      },
    });
    this.dispatcher.register({
      name: 'accounting.sync-payment',
      events: [BillingEvents.PaymentSucceeded],
      handle: async (event: DomainEventRecord<PaymentEventPayload>, tx: Prisma.TransactionClient) => {
        await this.jobs.enqueue(
          'qbo-sync',
          { entityType: 'PAYMENT', entityId: event.payload.paymentId, reason: 'succeeded' },
          { jobId: `qbo_PAYMENT_${event.payload.paymentId}`, tx },
        );
      },
    });
    this.dispatcher.register({
      name: 'accounting.credit-on-refund',
      events: [BillingEvents.PaymentRefunded],
      handle: async (event: DomainEventRecord<PaymentEventPayload>, tx: Prisma.TransactionClient) => {
        await this.jobs.enqueue(
          'qbo-sync',
          { entityType: 'CREDIT', entityId: event.payload.paymentId, reason: 'refund' },
          { jobId: `qbo_CREDIT_${event.payload.paymentId}_${event.payload.refundedCents}`, tx },
        );
      },
    });
  }
}

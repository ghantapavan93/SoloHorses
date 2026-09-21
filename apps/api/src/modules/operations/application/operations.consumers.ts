import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@daysheet/db';
import { EnvService } from '../../../platform/config/env.module';
import type { DomainEventRecord } from '../../../platform/events/domain-event';
import { EventDispatcher } from '../../../platform/events/event-dispatcher';
import { PlatformBus } from '../../../platform/observability/platform-bus';
import { JobsService } from '../../../platform/queue/jobs.service';
import {
  AccountingEvents,
  type DiscrepancyRaisedPayload,
  type DiscrepancyResolvedPayload,
} from '../../accounting/domain/events';
import { BillingEvents } from '../../billing/domain/events';
import { ReproductionEvents } from '../../reproduction/domain/events';
import { VeterinaryEvents } from '../../veterinary/domain/events';
import { kindForDeadQueue, titleForDeadJob } from '../domain/exceptions';
import { BriefService } from './brief.service';
import { DetectorsService } from './detectors.service';
import { ExceptionsService } from './exceptions.service';

interface DeadLetterPayload extends Record<string, unknown> {
  queue: string;
  attempts: number;
  error: string;
  payload: Record<string, unknown>;
}

/**
 * Where every source's idea of "failure" is turned into one shape.
 *
 *   dead job            → exception (kind by queue); recovery closes it
 *   books disagree      → exception; resolution closes it
 *   circuit open        → exception; circuit closed closes it
 *   anything changed    → run the detectors again, soon
 */
@Injectable()
export class OperationsConsumers implements OnModuleInit {
  private readonly logger = new Logger(OperationsConsumers.name);

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly exceptions: ExceptionsService,
    private readonly detectors: DetectorsService,
    private readonly brief: BriefService,
    private readonly jobs: JobsService,
    private readonly bus: PlatformBus,
    private readonly envService: EnvService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('detect-exceptions', ({ requestedBy }) =>
      this.detectors.detectAll(requestedBy).then(() => undefined),
    );
    this.jobs.register('brief-snapshot', ({ trigger }) => this.brief.snapshot(trigger).then(() => undefined));

    this.dispatcher.register({
      name: 'operations.dead-letter',
      events: ['JobDeadLettered'],
      handle: async (event: DomainEventRecord<DeadLetterPayload>, tx: Prisma.TransactionClient) => {
        const { queue, attempts, error, payload } = event.payload;
        await this.exceptions.raise(
          {
            kind: kindForDeadQueue(queue),
            dedupeKey: `job:${event.aggregateId}`,
            title: titleForDeadJob(queue, payload, attempts, error),
            detail: { jobId: event.aggregateId, queue, attempts, error, payload },
            entityType: typeof payload['entityType'] === 'string' ? titleCase(payload['entityType']) : null,
            entityId: typeof payload['entityId'] === 'string' ? payload['entityId'] : null,
            correlationId: event.correlationId,
          },
          tx,
        );
      },
    });

    this.dispatcher.register({
      name: 'operations.job-recovered',
      events: ['JobRecovered'],
      handle: async (event: DomainEventRecord, tx: Prisma.TransactionClient) => {
        await this.exceptions.resolveByKey(`job:${event.aggregateId}`, 'the job completed on retry', tx);
      },
    });

    this.dispatcher.register({
      name: 'operations.discrepancy-raised',
      events: [AccountingEvents.DiscrepancyRaised],
      handle: async (event: DomainEventRecord<DiscrepancyRaisedPayload>, tx: Prisma.TransactionClient) => {
        const { discrepancyId, kind, entityType, entityId, localValue, remoteValue } = event.payload;
        await this.exceptions.raise(
          {
            kind: 'RECONCILIATION_MISMATCH',
            dedupeKey: `discrepancy:${discrepancyId}`,
            title: `${entityId}: ${discrepancyLabel(kind)} — a person decides which side is right`,
            detail: { discrepancyId, discrepancyKind: kind, localValue, remoteValue },
            entityType: titleCase(entityType),
            entityId,
            correlationId: event.correlationId,
          },
          tx,
        );
      },
    });

    this.dispatcher.register({
      name: 'operations.discrepancy-resolved',
      events: [AccountingEvents.DiscrepancyResolved],
      handle: async (event: DomainEventRecord<DiscrepancyResolvedPayload>, tx: Prisma.TransactionClient) => {
        await this.exceptions.resolveByKey(
          `discrepancy:${event.payload.discrepancyId}`,
          `resolved on the Money page: ${event.payload.resolution.toLowerCase().replace('_', ' ')}`,
          tx,
        );
      },
    });

    // Anything that can change a detector's answer schedules a sweep. The job id makes bursts coalesce.
    this.dispatcher.register({
      name: 'operations.re-detect',
      events: [
        VeterinaryEvents.CheckRecorded,
        VeterinaryEvents.ClearanceRecorded,
        ReproductionEvents.EmbryoExpected,
        ReproductionEvents.IntakeConfirmed,
        ReproductionEvents.ContractStatusChanged,
        ReproductionEvents.PlannedRecipientAssigned,
        ReproductionEvents.TransferRecorded,
        BillingEvents.PaymentSucceeded,
        BillingEvents.PaymentProcessing,
        BillingEvents.PaymentReturned,
        BillingEvents.DocumentEligible,
        BillingEvents.LotSold,
      ],
      handle: async (_event: DomainEventRecord, tx: Prisma.TransactionClient) => {
        await this.jobs.enqueue(
          'detect-exceptions',
          { requestedBy: null },
          { jobId: `detect_${Math.floor(Date.now() / 5_000)}`, tx },
        );
      },
    });

    // A breaker is a process-level fact; it does not go through the outbox.
    this.bus.subscribe((signal) => {
      if (signal.kind !== 'breaker') return;
      const key = `breaker:${signal.dependency}`;
      const swallow = (error: Error) =>
        this.logger.warn(`breaker exception for ${signal.dependency}: ${error.message}`);
      if (signal.state === 'open') {
        void this.exceptions
          .raise({
            kind: 'INTEGRATION_DEGRADED',
            dedupeKey: key,
            title: `${dependencyLabel(signal.dependency)} is not responding; its circuit is open. Sync jobs are queued, nothing is lost, and the rest of the app is unaffected.`,
            detail: { dependency: signal.dependency, failures: signal.failures, cooldownMs: signal.cooldownMs },
          })
          .catch(swallow);
      } else if (signal.state === 'closed') {
        void this.exceptions
          .resolveByKey(
            key,
            `${dependencyLabel(signal.dependency)} answered a probe; the circuit closed and the queue is draining`,
          )
          .catch(swallow);
      }
    });

    if (this.envService.env.NODE_ENV !== 'test') {
      const timer = setInterval(
        () =>
          void this.jobs
            .enqueue('detect-exceptions', { requestedBy: null }, { jobId: `detect_${Math.floor(Date.now() / 5_000)}` })
            .catch(() => undefined),
        60_000,
      );
      timer.unref();
      // The morning's ledger: one snapshot row an hour, refreshed every quarter, and one soon after
      // boot so a fresh world has a first point. The job id is the quarter, so a restart within it
      // does not run twice; the row id is the hour, so the series stays one point an hour.
      const snapshot = (trigger: 'sweep' | 'boot') =>
        void this.jobs
          .enqueue(
            'brief-snapshot',
            { trigger },
            { jobId: `${this.brief.snapshotId()}_${Math.floor(new Date().getUTCMinutes() / 15)}` },
          )
          .catch(() => undefined);
      const boot = setTimeout(() => snapshot('boot'), 5_000);
      boot.unref();
      const quarterly = setInterval(() => snapshot('sweep'), 15 * 60_000);
      quarterly.unref();
    }
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function dependencyLabel(dependency: string): string {
  return dependency === 'quickbooks' ? 'QuickBooks' : dependency;
}

function discrepancyLabel(kind: string): string {
  switch (kind) {
    case 'AMOUNT_MISMATCH':
      return 'the amount in the books differs from ours';
    case 'CUSTOMER_MISMATCH':
      return 'the books file it under a different customer';
    case 'MISSING_REMOTE':
      return 'the books have no record of it';
    case 'MISSING_LOCAL':
      return 'the books have a document we do not';
    case 'UNLINKED_PAYMENT':
      return 'the payment is in the books but not applied to its invoice';
    default:
      return kind.toLowerCase().replace(/_/g, ' ');
  }
}

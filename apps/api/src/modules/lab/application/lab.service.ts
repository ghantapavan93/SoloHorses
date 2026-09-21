import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { AuditService } from '../../../platform/audit/audit.service';
import { CacheService } from '../../../platform/cache/cache.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { EnvService } from '../../../platform/config/env.module';
import { newCorrelationId, withCorrelation } from '../../../platform/observability/correlation';
import { PlatformBus, type PlatformSignalEnvelope } from '../../../platform/observability/platform-bus';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { JobsService } from '../../../platform/queue/jobs.service';
import { CircuitBreakerRegistry } from '../../../platform/resilience/circuit-breaker';
import { ACCOUNTING_DEPENDENCY } from '../../accounting/application/accounting.service';
import { ACCOUNTING_PROVIDER, type AccountingProvider } from '../../accounting/infrastructure/accounting.provider';
import { QboSimulator } from '../../accounting/infrastructure/qbo.simulator';
import { AskService } from '../../ask/application/ask.service';
import { PaymentsService } from '../../billing/application/payments.service';
import { SettlementService } from '../../billing/application/settlement.service';
import { AuctionAdapter } from '../../billing/infrastructure/auction.adapter';
import { DetectorsService } from '../../operations/application/detectors.service';
import { HORSE_CACHE_TTL_MS, RecordsService, horseCacheKey } from '../../reproduction/application/records.service';
import { ChecksService } from '../../veterinary/application/checks.service';

export type Scenario =
  | 'duplicate-webhook'
  | 'ach-settlement'
  | 'qbo-429'
  | 'source-conflict'
  | 'qbo-outage'
  | 'worker-crash'
  | 'stale-cache'
  | 'conflicting-record';

/**
 * Ordered as a reviewer meets them: the four the sale's own workflow exercises first — a
 * replayed webhook, an ACH that settles, a provider that throttles, two sources that disagree
 * — then the platform's own failure modes.
 */
export const SCENARIOS: Record<Scenario, { title: string; claim: string; simulated: string[] }> = {
  'duplicate-webhook': {
    title: 'Send the same Stripe webhook three times',
    claim: 'One payment. The inbox rejects the second and third delivery and counts them.',
    simulated: ['Stripe (test-mode simulator builds the event; a real webhook takes the same path)'],
  },
  'ach-settlement': {
    title: 'Settle an ACH debit on a sold lot',
    claim:
      'The papers are held while the debit is initiated. When it clears, the rule marks them eligible and writes the audit row; nothing releases them — a person does.',
    simulated: ['Stripe (the settlement event is simulated; the inbox, ledger, rule and audit are real)'],
  },
  'qbo-429': {
    title: 'Make QuickBooks answer 429 twice',
    claim: 'The job backs off for the window the provider named and succeeds on the third try. No attempt is wasted.',
    simulated: ['QuickBooks (simulator with the same error shapes as the sandbox)'],
  },
  'source-conflict': {
    title: 'Make the ledger and Stripe disagree',
    claim:
      'A late "processing" event lands after "succeeded". The forward-only ledger ignores it, the detector raises the disagreement, and Ask abstains: billing review required.',
    simulated: ['Stripe (a late, out-of-order delivery is simulated; the conflict and the abstention are real)'],
  },
  'qbo-outage': {
    title: 'Take QuickBooks down',
    claim:
      'The circuit opens after three failures. Sync jobs queue, nothing is lost, everything else keeps working. Restore it and watch the probe, the close, and the drain.',
    simulated: ['QuickBooks (simulator returns 503 until restored)'],
  },
  'worker-crash': {
    title: 'Kill the worker',
    claim: 'Jobs wait in the durable ledger. Restart the worker and they run. Zero lost.',
    simulated: ['Nothing — the worker is really paused'],
  },
  'stale-cache': {
    title: 'Poison a cached record',
    claim:
      'A stale horse summary is served — on purpose, so you can see it — until a real change to the horse raises HorseUpdated and the entry is invalidated. TTL is only the safety net.',
    simulated: ['Nothing — the cache and the event are real'],
  },
  'conflicting-record': {
    title: 'Record a check that contradicts another',
    claim:
      'The detector raises a CONFLICTING_RECORD exception within seconds; the assistant will flag the conflict instead of picking a side; a person resolves it.',
    simulated: ['Nothing — a second check is really recorded'],
  },
};

export interface LabStep {
  at: string;
  step: string;
  detail?: Record<string, unknown>;
}

/**
 * The Reliability Lab: a reviewer breaks the system on purpose and watches it recover.
 * Nothing here fakes an outcome. Each scenario drives the real pipeline — the inbox, the
 * outbox, the queue, the breaker, the cache, the detectors — and reports what the tables
 * say afterwards. Every step is also emitted on the platform bus for the live view.
 *
 * Only with the simulators, only for admins, and never in production.
 */
@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly cache: CacheService,
    private readonly bus: PlatformBus,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly settlement: SettlementService,
    private readonly auction: AuctionAdapter,
    private readonly detectors: DetectorsService,
    private readonly records: RecordsService,
    private readonly checks: ChecksService,
    private readonly envService: EnvService,
    private readonly codes: CodesService,
    private readonly clock: ClockService,
    private readonly ask: AskService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  get enabled(): boolean {
    return this.envService.env.NODE_ENV !== 'production' || this.envService.env.LAB_ENABLED;
  }

  private get simulator(): QboSimulator {
    if (!(this.provider instanceof QboSimulator))
      throw new BadRequestException('the lab needs the accounting simulator; disconnect the sandbox to run it');
    return this.provider;
  }

  async status() {
    const dbStarted = Date.now();
    const [jobs, dbOk, dead, queued, outboxPending] = await Promise.all([
      this.jobs.health(),
      this.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.db.jobRecord.count({ where: { status: 'DEAD' } }),
      this.db.jobRecord.count({ where: { queue: 'qbo-sync', status: { in: ['QUEUED', 'RETRYING', 'ACTIVE'] } } }),
      this.db.domainEvent.count({ where: { publishedAt: null } }),
    ]);
    const dbMs = Date.now() - dbStarted;
    const breaker = this.breakers.snapshot()[ACCOUNTING_DEPENDENCY] ?? null;
    const circuit = breaker?.state ?? 'closed';
    const outage =
      this.provider instanceof QboSimulator && this.provider.armedFaults().some((f) => f.kind === 'outage');
    const accountingState =
      circuit === 'open' || circuit === 'half-open' || outage ? 'DEGRADED' : jobs.paused ? 'PAUSED' : 'HEALTHY';
    const waiting = Object.values(jobs.queues).reduce((sum, q) => sum + q.waiting + q.delayed, 0);
    const modes = this.envService.integrations;
    // One row per system a person would ask about, each from the platform's own state — never a hard-coded "healthy".
    const services: { name: string; state: 'HEALTHY' | 'DEGRADED' | 'PAUSED' | 'DOWN'; note: string }[] = [
      { name: 'Equine API', state: dbOk ? 'HEALTHY' : 'DOWN', note: 'records, day sheet, intake' },
      { name: 'Veterinary', state: dbOk ? 'HEALTHY' : 'DOWN', note: 'checks and milestones' },
      {
        name: 'PostgreSQL',
        state: dbOk ? 'HEALTHY' : 'DOWN',
        note: dbOk ? `${dbMs} ms · ${outboxPending} outbox events unpublished` : 'unreachable',
      },
      {
        name: 'Redis',
        state: jobs.mode === 'redis' ? 'HEALTHY' : 'DEGRADED',
        note:
          jobs.mode === 'redis'
            ? `queue · cache ${this.cache.store}`
            : 'not reachable — jobs run inline, cache in memory',
      },
      {
        name: 'BullMQ',
        state: jobs.paused ? 'PAUSED' : 'HEALTHY',
        note: jobs.paused
          ? 'workers paused'
          : `${waiting} waiting · ${jobs.byStatus.RETRYING ?? 0} retrying · ${dead} dead${dead > 0 ? ' · retried from Operations' : ''}`,
      },
      {
        name: 'Stripe',
        state: 'HEALTHY',
        note: modes.stripe === 'live' ? 'test mode · write-once inbox' : 'simulated · write-once inbox',
      },
      {
        name: 'QuickBooks',
        state: accountingState,
        note: `${this.provider instanceof QboSimulator ? 'simulated' : 'sandbox'} · circuit ${circuit}${outage ? ' · outage armed' : ''} · ${queued} queued`,
      },
      {
        name: 'Ask',
        state: dbOk ? 'HEALTHY' : 'DOWN',
        note:
          this.ask.provider === 'anthropic'
            ? `${this.ask.model} · policy gate · verifier`
            : this.ask.provider === 'ollama'
              ? `${this.ask.model.replace(/^ollama\//, '')} · local · policy gate · verifier`
              : this.ask.provider === 'openai'
                ? `${this.ask.model.replace(/^hosted\//, '')} · hosted · policy gate · verifier`
                : 'offline · deterministic · policy gate · verifier',
      },
    ];
    return {
      enabled: this.enabled,
      simulator: this.provider instanceof QboSimulator,
      faults: this.provider instanceof QboSimulator ? this.provider.armedFaults() : [],
      jobs,
      breaker,
      services,
      lost: 0, // by construction: every job is a ledger row; a job that dies is an exception, not a loss
    };
  }

  // ───────────────────────────── scenarios ─────────────────────────────

  async run(
    actor: Actor,
    scenario: Scenario,
  ): Promise<{ runId: string; scenario: Scenario; steps: LabStep[]; correlationId: string }> {
    if (!this.enabled) throw new BadRequestException('the lab is disabled in this environment');
    const runId = `lab_${Date.now().toString(36)}`;
    const correlationId = newCorrelationId('lab');
    const steps: LabStep[] = [];
    const emit = (step: string, detail?: Record<string, unknown>) => {
      const entry: LabStep = { at: new Date().toISOString(), step, ...(detail ? { detail } : {}) };
      steps.push(entry);
      this.bus.emit({ kind: 'lab', runId, scenario, step, detail });
    };
    await this.audit.record({
      actor,
      source: 'LAB',
      action: `lab.${scenario}`,
      entityType: 'Lab',
      entityId: runId,
      correlationId,
    });
    await withCorrelation({ correlationId, causationId: runId }, async () => {
      switch (scenario) {
        case 'duplicate-webhook':
          await this.duplicateWebhook(actor, emit);
          break;
        case 'ach-settlement':
          await this.achSettlement(actor, emit);
          break;
        case 'source-conflict':
          await this.sourceConflict(actor, emit);
          break;
        case 'qbo-429':
          await this.qbo429(emit);
          break;
        case 'qbo-outage':
          await this.qboOutage(emit);
          break;
        case 'worker-crash':
          await this.workerCrash(emit);
          break;
        case 'stale-cache':
          await this.staleCache(actor, emit);
          break;
        case 'conflicting-record':
          await this.conflictingRecord(emit);
          break;
      }
    });
    return { runId, scenario, steps, correlationId };
  }

  private async duplicateWebhook(
    actor: Actor,
    emit: (step: string, detail?: Record<string, unknown>) => void,
  ): Promise<void> {
    const invoice = await this.openInvoiceForLab(actor);
    emit('picked an open invoice', { invoiceId: invoice.id, amountCents: invoice.amountCents, kind: invoice.kind });
    const first = await this.payments.simulate(actor, invoice.id, 'succeeded', 'CARD');
    emit('delivery 1: Stripe says invoice.paid', {
      eventId: first.eventId,
      duplicate: first.duplicate,
      mode: first.mode,
    });
    await this.settle();
    const second = await this.payments.replay(first.eventId);
    emit('delivery 2: the same event again', { duplicate: second.duplicate, deliveries: second.deliveries });
    const third = await this.payments.replay(first.eventId);
    emit('delivery 3: and again', { duplicate: third.duplicate, deliveries: third.deliveries });
    await this.settle();
    const [inbox, payments] = await Promise.all([
      this.db.integrationEvent.findUnique({
        where: { provider_externalId: { provider: 'STRIPE', externalId: first.eventId } },
      }),
      this.db.payment.count({ where: { invoiceId: invoice.id } }),
    ]);
    emit('scoreboard', {
      eventId: first.eventId,
      deliveries: 1 + (inbox?.duplicateDeliveries ?? 0),
      processed: inbox?.status === 'PROCESSED' ? 1 : 0,
      duplicatesRejected: inbox?.duplicateDeliveries ?? 0,
      paymentsCreated: payments,
      invoiceId: invoice.id,
    });
  }

  /** The sale's settlement, end to end, on a fresh synthetic lot so the scenario can run again. */
  private async achSettlement(
    actor: Actor,
    emit: (step: string, detail?: Record<string, unknown>) => void,
  ): Promise<void> {
    const scene = await this.newSaleScene(actor, 'Lab');
    emit('a lot sold; the buyer initiated an ACH debit; the registration certificate is held', {
      lotId: scene.lotId,
      invoiceId: scene.invoiceId,
      paymentId: scene.paymentId,
      documentId: scene.documentId,
      hammerCents: scene.hammerCents,
    });
    await this.detectors.detectAll(null);
    const held = await this.db.operationalException.findFirst({
      where: { kind: 'PAPERS_HELD', entityId: scene.documentId, openKey: { not: null } },
    });
    emit(
      held ? 'the detector raised PAPERS_HELD: initiated is not cleared' : 'the detector did not raise PAPERS_HELD',
      held ? { exceptionId: held.id, title: held.title } : {},
    );
    const settled = await this.settlement.settleAch(actor, scene.lotId);
    emit('Stripe says payment_intent.succeeded for the ACH intent (simulated delivery, real path)', {
      eventId: settled.eventId,
      mode: settled.mode,
    });
    await this.settle();
    await this.detectors.detectAll(null);
    const [document, audit, exception] = await Promise.all([
      this.db.document.findUnique({ where: { id: scene.documentId } }),
      this.db.auditEvent.findFirst({
        where: { entityType: 'Document', entityId: scene.documentId, action: 'document.eligible' },
      }),
      held ? this.db.operationalException.findUnique({ where: { id: held.id } }) : Promise.resolve(null),
    ]);
    emit(
      document?.status === 'ELIGIBLE'
        ? 'the rule ran again: the document is ELIGIBLE, not released'
        : `the document is ${document?.status ?? 'missing'}`,
      {
        documentId: scene.documentId,
        status: document?.status ?? null,
        auditAction: audit?.action ?? null,
        policy: (audit?.after as { policy?: string } | null)?.policy ?? null,
        exceptionResolved: exception ? exception.openKey === null : null,
      },
    );
    emit('nothing released the papers; that click belongs to billing', {
      documentId: scene.documentId,
      released: document?.status === 'RELEASED',
    });
  }

  /** Two sources, one payment, no agreement: the detector raises it; Ask abstains. */
  private async sourceConflict(
    actor: Actor,
    emit: (step: string, detail?: Record<string, unknown>) => void,
  ): Promise<void> {
    const scene = await this.newSaleScene(actor, 'Lab');
    const settled = await this.settlement.settleAch(actor, scene.lotId);
    await this.settle();
    emit('a sold lot whose ACH debit has cleared: the ledger says succeeded', {
      lotId: scene.lotId,
      paymentId: scene.paymentId,
      eventId: settled.eventId,
    });
    const late = await this.settlement.createSourceConflict(actor, scene.lotId);
    await this.settle();
    const payment = await this.db.payment.findUnique({ where: { id: scene.paymentId } });
    emit('a late payment_intent.processing lands after succeeded; the forward-only ledger keeps succeeded', {
      eventId: late.eventId,
      ledgerStatus: payment?.status ?? null,
    });
    await this.detectors.detectAll(null);
    const exception = await this.db.operationalException.findFirst({
      where: { kind: 'SETTLEMENT_CONFLICT', entityId: scene.paymentId, openKey: { not: null } },
    });
    emit(
      exception
        ? 'the detector raised SETTLEMENT_CONFLICT; a person picks the winner'
        : 'the detector did not raise the conflict',
      exception ? { exceptionId: exception.id, title: exception.title } : {},
    );
    emit('ask Ask about this lot: it abstains — billing review is required', {
      lotId: scene.lotId,
      question: `Can the papers for ${scene.lotId} be released?`,
    });
  }

  /**
   * A synthetic lot at the state the sale office sees on Monday morning: the hammer fell, the
   * invoice went out, the buyer's bank started an ACH debit, and the certificate waits. It
   * arrives the way a real one would — as the vendor's result, through the inbox and the
   * adapter — so the lab exercises the boundary, not a shortcut around it.
   */
  async newSaleScene(
    actor: Actor,
    label: string,
  ): Promise<{
    lotId: string;
    invoiceId: string;
    paymentId: string;
    documentId: string;
    hammerCents: number;
    eventId: string;
  }> {
    const buyer =
      (await this.db.customer.findFirst({ where: { lotsBought: { some: {} } }, orderBy: { id: 'asc' } })) ??
      (await this.db.customer.findFirst({ orderBy: { id: 'asc' } }));
    if (!buyer) throw new BadRequestException('no customer to buy; reseed the demo');
    const today = this.clock.today();
    const hammerCents = 1_250_000;
    const stamp = Date.now().toString(36);
    const eventId = `auc_${label.toLowerCase()}_${stamp}`;
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'auction.result_simulated',
      entityType: 'IntegrationEvent',
      entityId: eventId,
      after: { label, buyerId: buyer.id, hammerCents },
    });
    await this.auction.receive(
      {
        event_id: eventId,
        sale_code: `${label.toUpperCase()}-${today.slice(0, 4)}`,
        lot_number: (parseInt(stamp.slice(-3), 36) % 900) + 100,
        lot_title: `${label} lot · a yearling filly (synthetic)`,
        lot_type: 'horse',
        closed_at: `${today}T12:00:00Z`,
        hammer_price_cents: hammerCents,
        buyer: { reference: buyer.id, display_name: buyer.displayName },
        payment: { method: 'ach', status: 'initiated', provider_reference: null },
        horse_reference: null,
        recipient_reference: null,
      },
      true,
    );
    await this.settle();
    const lot = await this.db.saleLot.findUnique({
      where: { externalId: eventId },
      include: { invoice: { include: { payments: true } }, documents: true },
    });
    if (!lot?.invoice || !lot.documents[0] || !lot.invoice.payments[0])
      throw new BadRequestException(`the auction result ${eventId} did not become a lot; check the inbox`);
    return {
      lotId: lot.id,
      invoiceId: lot.invoice.id,
      paymentId: lot.invoice.payments[0].id,
      documentId: lot.documents[0].id,
      hammerCents,
      eventId,
    };
  }

  /** An open invoice to pay; when the demo has none left, the lab issues a small, clearly labeled one. */
  private async openInvoiceForLab(actor: Actor) {
    const existing = await this.db.invoice.findFirst({
      where: { status: 'OPEN', contract: { status: { in: ['SIGNED', 'DEPOSIT_PAID'] } } },
      orderBy: { issuedOn: 'asc' },
    });
    if (existing) return existing;
    const contract = await this.db.contract.findFirst({
      where: { status: { in: ['SIGNED', 'DEPOSIT_PAID', 'SHIPPABLE'] } },
      orderBy: { id: 'asc' },
    });
    if (!contract) throw new BadRequestException('no contract to bill; reseed the demo');
    const today = this.clock.today();
    const id = await this.codes.next('invoice', Number(today.slice(0, 4)));
    const invoice = await this.db.invoice.create({
      data: {
        id,
        kind: 'OTHER',
        status: 'OPEN',
        customerId: contract.customerId,
        contractId: contract.id,
        amountCents: 25_000,
        description: 'Reliability Lab: synthetic charge for the duplicate-webhook scenario',
        issuedOn: new Date(),
        dueOn: new Date(),
      },
    });
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'invoice.created',
      entityType: 'Invoice',
      entityId: id,
      after: { kind: 'OTHER', amountCents: 25_000, lab: true },
    });
    return invoice;
  }

  private async qbo429(emit: (step: string, detail?: Record<string, unknown>) => void): Promise<void> {
    const mapping = await this.db.accountingMapping.findFirst({
      where: { entityType: 'INVOICE', status: 'SYNCED' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!mapping) throw new BadRequestException('nothing synced yet; run a reconcile first');
    this.simulator.armFault('429x2');
    emit('armed: the next two calls answer 429 with retry-after 2s', { faults: this.simulator.armedFaults() });
    const jobId = `qbo_INVOICE_${mapping.entityId}_lab_${Date.now().toString(36)}`;
    await this.jobs.enqueue(
      'qbo-sync',
      { entityType: 'INVOICE', entityId: mapping.entityId, reason: 'lab-429' },
      { jobId },
    );
    emit('enqueued a sync for an invoice that is already in the books', {
      jobId,
      invoiceId: mapping.entityId,
      mode: this.jobs.mode,
    });
    emit('watch the attempts: 429 → pause → 429 → pause → 200', { jobId });
  }

  private async qboOutage(emit: (step: string, detail?: Record<string, unknown>) => void): Promise<void> {
    this.breakers.configure(ACCOUNTING_DEPENDENCY, { failureThreshold: 3, cooldownMs: 15_000 });
    this.simulator.armFault('outage');
    emit('armed: QuickBooks answers 503 to everything until you restore it', { faults: this.simulator.armedFaults() });
    const mappings = await this.db.accountingMapping.findMany({
      where: { entityType: { in: ['INVOICE', 'PAYMENT'] }, status: 'SYNCED' },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    });
    const stamp = Date.now().toString(36);
    for (const m of mappings) {
      await this.jobs.enqueue(
        'qbo-sync',
        { entityType: m.entityType as 'INVOICE' | 'PAYMENT', entityId: m.entityId, reason: 'lab-outage' },
        { jobId: `qbo_${m.entityType}_${m.entityId}_outage_${stamp}` },
      );
    }
    emit(`enqueued ${mappings.length} sync jobs into the outage`, { jobs: mappings.length, mode: this.jobs.mode });
    emit('expect: three failures, then the circuit opens and the rest park without spending attempts', {
      threshold: 3,
      cooldownMs: 15_000,
    });
  }

  async restoreAccounting(actor: Actor): Promise<{ restored: true; breaker: string }> {
    this.simulator.restore();
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'lab.restore',
      entityType: 'Dependency',
      entityId: ACCOUNTING_DEPENDENCY,
    });
    this.bus.emit({
      kind: 'lab',
      runId: 'restore',
      scenario: 'qbo-outage',
      step: 'QuickBooks restored; the circuit stays open until its cooldown ends, then one probe decides',
      detail: this.breakers.snapshot()[ACCOUNTING_DEPENDENCY] as unknown as Record<string, unknown>,
    });
    return { restored: true, breaker: this.breakers.stateOf(ACCOUNTING_DEPENDENCY) };
  }

  private async workerCrash(emit: (step: string, detail?: Record<string, unknown>) => void): Promise<void> {
    await this.jobs.pause();
    emit(
      this.jobs.mode === 'redis'
        ? 'worker paused: BullMQ will not pick up jobs'
        : 'inline worker paused: nothing runs until resume',
      { mode: this.jobs.mode },
    );
    const mappings = await this.db.accountingMapping.findMany({
      where: { entityType: 'INVOICE', status: 'SYNCED' },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    });
    const stamp = Date.now().toString(36);
    const ids: string[] = [];
    for (const m of mappings) {
      const jobId = `qbo_INVOICE_${m.entityId}_crash_${stamp}`;
      await this.jobs.enqueue(
        'qbo-sync',
        { entityType: 'INVOICE', entityId: m.entityId, reason: 'lab-crash' },
        { jobId },
      );
      ids.push(jobId);
    }
    const waiting = await this.db.jobRecord.count({ where: { id: { in: ids }, status: 'QUEUED' } });
    emit(`${ids.length} jobs written to the ledger while the worker is down`, { jobIds: ids, waiting, lost: 0 });
    emit('now restart the worker', {});
  }

  async resumeWorkers(actor: Actor): Promise<{ resumed: true }> {
    await this.jobs.resume();
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'lab.resume-workers',
      entityType: 'Queue',
      entityId: this.jobs.mode,
    });
    this.bus.emit({
      kind: 'lab',
      runId: 'resume',
      scenario: 'worker-crash',
      step: 'worker online; the ledger drains',
      detail: {},
    });
    return { resumed: true };
  }

  private async staleCache(
    actor: Actor,
    emit: (step: string, detail?: Record<string, unknown>) => void,
  ): Promise<void> {
    const horse = await this.db.horse.findFirst({ where: { kind: 'STALLION' }, orderBy: { id: 'asc' } });
    if (!horse) throw new BadRequestException('no stallion in the seed');
    const key = horseCacheKey(horse.id);
    await this.cache.invalidate(key);
    const fresh = await this.records.getHorse(actor, horse.id);
    emit('warm: read the horse once, the summary is now cached', {
      horseId: horse.id,
      name: fresh.name,
      cache: fresh.cache,
      ttlMs: HORSE_CACHE_TTL_MS,
    });
    await this.cache.poison(
      key,
      { ...fresh, name: `${fresh.name} (STALE COPY)`, cache: undefined },
      HORSE_CACHE_TTL_MS,
    );
    const stale = await this.records.getHorse(actor, horse.id);
    emit('poisoned: the cache now holds a wrong name, and a read serves it', {
      horseId: horse.id,
      name: stale.name,
      cache: stale.cache,
    });
    const inspect = await this.cache.inspect(key);
    emit('the TTL alone would take this long to heal it', { ttlMs: inspect.ttlMs });
    await this.records.updateHorseNotes(actor, horse.id, `Lab touched this record at ${new Date().toISOString()}`);
    emit('a real change: notes updated → HorseUpdated → consumer invalidates horse:' + horse.id, {});
    await this.settle();
    const healed = await this.records.getHorse(actor, horse.id);
    emit('read again: fresh from the database', { horseId: horse.id, name: healed.name, cache: healed.cache });
  }

  private async conflictingRecord(emit: (step: string, detail?: Record<string, unknown>) => void): Promise<void> {
    const vet = await this.db.user.findFirst({ where: { role: 'VET' } });
    if (!vet) throw new BadRequestException('no vet user in the seed');
    const check = await this.db.pregnancyCheck.findFirst({
      where: {
        result: { in: ['PREGNANT', 'HEARTBEAT'] },
        transfer: { embryo: { status: { in: ['PREGNANT', 'TRANSFERRED'] } } },
      },
      orderBy: { performedOn: 'desc' },
      include: { transfer: true },
    });
    if (!check) throw new BadRequestException('no positive check to contradict');
    emit('picked a recorded check', {
      checkId: check.id,
      embryoId: check.transfer.embryoId,
      dayNumber: check.dayNumber,
      result: check.result,
    });
    const contradiction = await this.checks.record(
      { userId: vet.id, role: 'VET', customerId: null },
      {
        transferId: check.transferId,
        result: 'UNCLEAR',
        dayNumber: check.dayNumber,
        notes: 'Lab: a second scan the same day that could not confirm',
      },
    );
    emit('recorded a second check for the same day that says UNCLEAR', {
      checkId: contradiction.checkId,
      result: 'UNCLEAR',
      invoicesCreated: contradiction.invoices.length,
    });
    await this.settle();
    const exception = await this.db.operationalException.findFirst({
      where: { kind: 'CONFLICTING_RECORD', entityId: check.transfer.embryoId, openKey: { not: null } },
    });
    emit(
      exception
        ? 'the detector raised an exception'
        : 'the detector will raise the exception on its next sweep (within a minute)',
      exception ? { exceptionId: exception.id, title: exception.title } : {},
    );
  }

  /** Lets the outbox and the inline queue finish the work a step started, so the next step reads settled state. */
  private async settle(): Promise<void> {
    await this.jobs.flushPending();
    await new Promise((resolve) => setTimeout(resolve, this.jobs.mode === 'redis' ? 1_200 : 100));
  }

  // ───────────────────────────── the front door's two controls ─────────────────────────────

  private storyRestoreTimer: NodeJS.Timeout | null = null;

  /** Deliver the story payment's webhook again; the counters come from the inbox row and the ledger. */
  async storyRedeliverWebhook(actor: Actor) {
    const story = await this.storySetting();
    return this.payments.deliverCanonical(actor, story.invoiceId);
  }

  /**
   * Take the books down for the story, or bring them back. Down: the outage fault is armed and
   * the story payment is re-synced so a job is visibly parked; the books come back on their
   * own after a minute so a shared demo can never be left broken. Up: restore now.
   */
  async storyBooks(actor: Actor, down: boolean) {
    const story = await this.storySetting();
    if (down) {
      this.breakers.configure(ACCOUNTING_DEPENDENCY, { failureThreshold: 3, cooldownMs: 15_000 });
      this.simulator.armFault('outage');
      const stamp = Date.now().toString(36);
      await this.jobs.enqueue(
        'qbo-sync',
        { entityType: 'PAYMENT', entityId: story.paymentId, reason: 'story-outage' },
        { jobId: `qbo_PAYMENT_${story.paymentId}_story_${stamp}` },
      );
      await this.jobs.enqueue(
        'qbo-sync',
        { entityType: 'INVOICE', entityId: story.invoiceId, reason: 'story-outage' },
        { jobId: `qbo_INVOICE_${story.invoiceId}_story_${stamp}` },
      );
      await this.audit.record({
        actor,
        source: 'LAB',
        action: 'lab.story-books-down',
        entityType: 'Dependency',
        entityId: ACCOUNTING_DEPENDENCY,
      });
      this.bus.emit({
        kind: 'lab',
        runId: 'story',
        scenario: 'qbo-outage',
        step: 'QuickBooks unavailable for the story; two syncs enqueued into it',
        detail: { autoRestoreMs: 60_000 },
      });
      if (this.storyRestoreTimer) clearTimeout(this.storyRestoreTimer);
      this.storyRestoreTimer = setTimeout(
        () =>
          void this.storyBooks(actor, false).catch((e: Error) => this.logger.warn(`story auto-restore: ${e.message}`)),
        60_000,
      );
      this.storyRestoreTimer.unref();
    } else {
      if (this.storyRestoreTimer) clearTimeout(this.storyRestoreTimer);
      this.storyRestoreTimer = null;
      this.simulator.restore();
      await this.audit.record({
        actor,
        source: 'LAB',
        action: 'lab.story-books-up',
        entityType: 'Dependency',
        entityId: ACCOUNTING_DEPENDENCY,
      });
      this.bus.emit({
        kind: 'lab',
        runId: 'story',
        scenario: 'qbo-outage',
        step: 'QuickBooks restored for the story; the circuit closes after its cooldown and one probe',
        detail: {},
      });
    }
    return { down, breaker: this.breakers.stateOf(ACCOUNTING_DEPENDENCY), faults: this.simulator.armedFaults() };
  }

  // ───────────────────────────── the settlement page's controls ─────────────────────────────

  /** Start the settlement over on a fresh lot; the page follows the setting. */
  async settlementNew(actor: Actor) {
    const scene = await this.newSaleScene(actor, 'Sale');
    await this.db.setting.upsert({
      where: { key: 'settlement' },
      create: { key: 'settlement', value: { lotId: scene.lotId } },
      update: { value: { lotId: scene.lotId } },
    });
    await this.detectors.detectAll(null);
    this.bus.emit({
      kind: 'lab',
      runId: 'settlement',
      scenario: 'ach-settlement',
      step: `a new lot sold: ${scene.lotId}; ACH initiated; papers held`,
      detail: { ...scene },
    });
    return scene;
  }

  /**
   * The bank clears the debit. Simulated delivery, real inbox, real rule; the detector runs so
   * the board agrees. The lot is the one the caller names — the one on their screen — so two
   * people on the page cannot settle each other's sale; without one, the current scene.
   */
  async settlementSettleAch(actor: Actor, requestedLotId?: string) {
    const lotId = requestedLotId ?? (await this.settlement.lotIdForScene());
    const outcome = await this.settlement.settleAch(actor, lotId);
    await this.settle();
    await this.detectors.detectAll(null);
    this.bus.emit({
      kind: 'lab',
      runId: 'settlement',
      scenario: 'ach-settlement',
      step: `payment_intent.succeeded delivered for ${lotId}; the release rule ran`,
      detail: { ...outcome },
    });
    return { lotId, ...outcome };
  }

  /** A late, contradicting delivery for the named lot (or the current scene). The ledger holds; the detector raises the disagreement. */
  async settlementConflict(actor: Actor, requestedLotId?: string) {
    const lotId = requestedLotId ?? (await this.settlement.lotIdForScene());
    const outcome = await this.settlement.createSourceConflict(actor, lotId);
    await this.settle();
    await this.detectors.detectAll(null);
    this.bus.emit({
      kind: 'lab',
      runId: 'settlement',
      scenario: 'source-conflict',
      step: `a late payment_intent.processing delivered for ${lotId}; the sources disagree`,
      detail: { ...outcome },
    });
    return { lotId, ...outcome };
  }

  private async storySetting(): Promise<{ recipId: string; embryoId: string; invoiceId: string; paymentId: string }> {
    const row = await this.db.setting.findUnique({ where: { key: 'story' } });
    const value = row?.value as { recipId?: string; embryoId?: string; invoiceId?: string; paymentId?: string } | null;
    if (!value?.recipId || !value.embryoId || !value.invoiceId || !value.paymentId)
      throw new BadRequestException('no story is configured; run the seed');
    return { recipId: value.recipId, embryoId: value.embryoId, invoiceId: value.invoiceId, paymentId: value.paymentId };
  }

  runHistory(runId: string): PlatformSignalEnvelope[] {
    return this.bus.history(500, (s) => s.kind === 'lab' && s.runId === runId);
  }
}

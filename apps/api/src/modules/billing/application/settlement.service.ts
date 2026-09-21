import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  evaluateRecipReturn,
  evaluateRegistrationRelease,
  fundsState,
  settlementDueOn,
  settlementSourcesAgree,
  REGISTRATION_RELEASE_POLICY,
  SETTLEMENT_DUE_TIME,
  type Actor,
  type RuleResult,
} from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { type DomainEventRecord } from '../../../platform/events/domain-event';
import { EventDispatcher } from '../../../platform/events/event-dispatcher';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { CodesService } from '../../../platform/codes/codes.service';
import {
  BillingEvents,
  type DocumentEligiblePayload,
  type LotSoldPayload,
  type PaymentEventPayload,
} from '../domain/events';
import { PaymentsService } from './payments.service';

/** A sale result in the sale's own words — what the auction adapter hands billing. */
export interface AuctionResult {
  externalId: string;
  saleCode: string;
  lotNumber: number;
  title: string;
  kind: 'HORSE' | 'IN_UTERO';
  closedOn: string;
  hammerCents: number;
  buyer: { reference: string; name: string };
  payment: {
    method: 'ACH' | 'CARD' | 'CHECK' | 'CASH';
    state: 'INITIATED' | 'CLEARED' | 'NONE';
    providerReference: string | null;
  };
  horseId: string | null;
  recipId: string | null;
}

/**
 * Sale settlement and the papers behind it, from the sale's published conditions: settlement
 * is due the Monday after the sale at 5 PM CST, and registration certificates are held until
 * payment clears — never released on sale day.
 *
 * The consumer marks a document ELIGIBLE when the rule says the money has cleared; it never
 * releases one. Release is a person's click with billing rights, audited with their name.
 */
export interface SettlementScene {
  today: string;
  lot: {
    id: string;
    kind: string;
    title: string;
    closedOn: string;
    hammerCents: number;
    buyer: { id: string; name: string };
  };
  invoice: { id: string; status: string; amountCents: number; dueOn: string; dueTime: string } | null;
  payment: {
    id: string;
    method: string;
    status: string;
    amountCents: number;
    stripePaymentIntentId: string | null;
    receivedAt: string;
  } | null;
  document: {
    id: string;
    kind: string;
    status: string;
    eligibleAt: string | null;
    releasedAt: string | null;
    releasedBy: { id: string; name: string } | null;
  } | null;
  funds: string;
  rule: RuleResult & { policy: string };
  sources: { system: string; state: string; note: string | null }[];
  conflict: RuleResult | null;
  stripe: { eventId: string; type: string; status: string; receivedAt: string }[];
  audit: {
    at: string;
    action: string;
    actor: string | null;
    source: string;
    after: Record<string, unknown> | null;
    correlationId: string | null;
  }[];
  /** The sale's other condition: a recip sold with a foal in utero comes back, and the vet says how. */
  returns: InUteroReturn[];
}

export interface InUteroReturn {
  lot: { id: string; title: string; closedOn: string; hammerCents: number; buyer: { id: string; name: string } };
  recip: {
    id: string;
    number: number | null;
    status: string | null;
    weanedOn: string | null;
    returnedOn: string | null;
  };
  assessment: { id: string; result: string; performedOn: string; note: string | null } | null;
  rule: RuleResult;
  /** What the rule leaves to a person, in one word: nothing yet, no fee, or a decision. */
  decision: 'WAITING_ON_VET' | 'CONDITION_MET' | 'A_PERSON_DECIDES';
}

@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: EventDispatcher,
    private readonly clock: ClockService,
    private readonly payments: PaymentsService,
    private readonly codes: CodesService,
  ) {}

  /**
   * A lot closed on the vendor's platform becomes a sale here: the lot, the settlement invoice,
   * the buyer's payment as far as it has got, and the certificate — held, because no paper is
   * released on sale day. Idempotent on the vendor's event id: a redelivered result finds its lot.
   */
  async recordAuctionResult(
    result: AuctionResult,
    simulated: boolean,
    correlationId: string | null,
  ): Promise<{
    lotId: string;
    invoiceId: string;
    paymentId: string | null;
    documentId: string | null;
    created: boolean;
  }> {
    const existing = await this.db.saleLot.findUnique({
      where: { externalId: result.externalId },
      include: { documents: true, invoice: { include: { payments: true } } },
    });
    if (existing)
      return {
        lotId: existing.id,
        invoiceId: existing.invoiceId ?? '',
        paymentId: existing.invoice?.payments[0]?.id ?? null,
        documentId: existing.documents[0]?.id ?? null,
        created: false,
      };
    const season = Number(result.closedOn.slice(0, 4));
    return this.db
      .$transaction(async (tx) => {
        // The buyer is the office's customer, matched on the reference the vendor carries; a new bidder becomes a new customer, audited as such.
        let buyer = await tx.customer.findUnique({ where: { id: result.buyer.reference } });
        if (!buyer) {
          const id = await this.codes.next('customer', season, tx);
          buyer = await tx.customer.create({
            data: {
              id,
              displayName: result.buyer.name,
              notes: `Buyer from the sale platform (${result.saleCode}); created from an auction result`,
            },
          });
          await this.audit.record(
            {
              actor: null,
              source: 'JOB',
              action: 'customer.created',
              entityType: 'Customer',
              entityId: id,
              after: { from: 'auction', reference: result.buyer.reference, simulated },
              correlationId: correlationId ?? undefined,
            },
            tx,
          );
        }
        const lotId = await this.codes.next('lot', season, tx);
        const invoiceId = await this.codes.next('invoice', season, tx);
        const closedOn = new Date(`${result.closedOn}T21:30:00Z`);
        const paid = result.payment.state === 'CLEARED';
        await tx.invoice.create({
          data: {
            id: invoiceId,
            kind: 'SALE_SETTLEMENT',
            status: paid ? 'PAID' : 'OPEN',
            customerId: buyer.id,
            amountCents: result.hammerCents,
            description: `Sale settlement · Lot ${result.lotNumber} (${result.saleCode})`,
            issuedOn: closedOn,
            dueOn: new Date(`${settlementDueOn(result.closedOn)}T22:00:00Z`),
          },
        });
        await tx.saleLot.create({
          data: {
            id: lotId,
            kind: result.kind,
            title: result.title,
            externalId: result.externalId,
            saleCode: result.saleCode,
            lotNumber: result.lotNumber,
            closedOn,
            hammerCents: result.hammerCents,
            buyerId: buyer.id,
            invoiceId,
            horseId: result.horseId,
            recipId: result.recipId,
          },
        });
        let paymentId: string | null = null;
        if (result.payment.state !== 'NONE') {
          paymentId = await this.codes.next('payment', season, tx);
          await tx.payment.create({
            data: {
              id: paymentId,
              invoiceId,
              customerId: buyer.id,
              method: result.payment.method,
              status: paid ? 'SUCCEEDED' : 'PROCESSING',
              amountCents: result.hammerCents,
              stripePaymentIntentId:
                result.payment.providerReference ?? `pi_sim_${paymentId.toLowerCase().replace(/-/g, '')}`,
              receivedAt: new Date(),
            },
          });
        }
        let documentId: string | null = null;
        if (result.kind === 'HORSE') {
          documentId = await this.codes.next('document', season, tx);
          await tx.document.create({
            data: { id: documentId, kind: 'REGISTRATION_CERTIFICATE', status: 'HELD', lotId },
          });
        }
        await this.audit.record(
          {
            actor: null,
            source: 'JOB',
            action: 'lot.sold',
            entityType: 'SaleLot',
            entityId: lotId,
            after: {
              from: 'auction',
              externalId: result.externalId,
              invoiceId,
              paymentId,
              documentId,
              hammerCents: result.hammerCents,
              method: result.payment.method,
              paymentState: result.payment.state,
              documentStatus: documentId ? 'HELD' : null,
              simulated,
            },
            correlationId: correlationId ?? undefined,
          },
          tx,
        );
        const payload: LotSoldPayload = {
          lotId,
          invoiceId,
          paymentId,
          documentId,
          buyerId: buyer.id,
          hammerCents: result.hammerCents,
          simulated,
        };
        await this.outbox.append(tx, {
          aggregateType: 'SaleLot',
          aggregateId: lotId,
          type: BillingEvents.LotSold,
          payload,
        });
        return { lotId, invoiceId, paymentId, documentId, created: true };
      })
      .then(async (out) => {
        await this.outbox.flush();
        return out;
      });
  }

  private get db() {
    return this.prisma.client;
  }

  onModuleInit(): void {
    // Money cleared → the rule runs again → the document may become eligible. Same transaction
    // as the processed-event row; the fact cannot be consumed without its consequence.
    this.dispatcher.register({
      name: 'billing.papers-eligible',
      events: [BillingEvents.PaymentSucceeded],
      handle: async (event: DomainEventRecord<PaymentEventPayload>, tx: Prisma.TransactionClient) => {
        if (!event.payload.invoiceId) return;
        await this.reevaluate(event.payload.invoiceId, event.correlationId, tx);
      },
    });
    // The bank took the money back: papers that were only eligible are held again. Papers that
    // went out cannot be pulled back by software; the detector raises that for a person, at once.
    this.dispatcher.register({
      name: 'billing.papers-held-again',
      events: [BillingEvents.PaymentReturned],
      handle: async (event: DomainEventRecord<PaymentEventPayload>, tx: Prisma.TransactionClient) => {
        if (!event.payload.invoiceId) return;
        await this.holdAgain(event.payload.invoiceId, event.correlationId, tx);
      },
    });
  }

  /** The seeded scene, or a lot by id. */
  async lotIdForScene(): Promise<string> {
    const setting = await this.db.setting.findUnique({ where: { key: 'settlement' } });
    const lotId = (setting?.value as { lotId?: string } | null)?.lotId;
    if (!lotId) throw new NotFoundException('no settlement scene is configured; run the seed');
    return lotId;
  }

  async scene(actor: Actor, lotId: string): Promise<SettlementScene> {
    const lot = await this.db.saleLot.findUnique({
      where: { id: lotId },
      include: {
        buyer: true,
        invoice: { include: { payments: { orderBy: { receivedAt: 'asc' } } } },
        documents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!lot) throw new NotFoundException(`${lotId} not found`);
    if (actor.role === 'CUSTOMER' && actor.customerId !== lot.buyerId)
      throw new NotFoundException(`${lotId} not found`);
    const document = lot.documents[0] ?? null;
    const invoice = lot.invoice;
    const payments = invoice?.payments ?? [];
    const payment =
      payments.find((p) => p.status === 'PROCESSING' || p.status === 'PENDING') ??
      payments.find((p) => p.status === 'SUCCEEDED') ??
      payments[0] ??
      null;
    const rule =
      invoice && document
        ? evaluateRegistrationRelease(
            { id: lot.id, documentId: document.id },
            { id: invoice.id, amountCents: invoice.amountCents, status: invoice.status },
            payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
          )
        : ({
            ok: false,
            code: 'SETTLEMENT_UNPAID',
            reason: 'no invoice or document on this lot',
            evidenceIds: [lot.id],
          } as RuleResult);
    const funds = invoice
      ? fundsState(
          { id: invoice.id, amountCents: invoice.amountCents, status: invoice.status },
          payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
        )
      : 'UNPAID';

    const stripeRows = invoice
      ? await this.db.integrationEvent.findMany({
          where: {
            provider: 'STRIPE',
            OR: [
              { payload: { path: ['data', 'object', 'metadata', 'invoiceId'], equals: invoice.id } },
              ...(payment?.stripePaymentIntentId
                ? [{ payload: { path: ['data', 'object', 'id'], equals: payment.stripePaymentIntentId } }]
                : []),
            ],
          },
          orderBy: { receivedAt: 'asc' },
        })
      : [];
    const latestIntentEvent = [...stripeRows].reverse().find((e) => e.type.startsWith('payment_intent.'));
    const providerWord = latestIntentEvent
      ? (latestIntentEvent.type.replace('payment_intent.', '') as
          'processing' | 'succeeded' | 'payment_failed' | 'canceled')
      : null;
    const conflict =
      payment && providerWord
        ? settlementSourcesAgree(payment.status, providerWord === 'payment_failed' ? 'failed' : providerWord)
        : null;

    const ids = [
      lot.id,
      ...(invoice ? [invoice.id] : []),
      ...payments.map((p) => p.id),
      ...(document ? [document.id] : []),
    ];
    const auditRows = await this.db.auditEvent.findMany({ where: { entityId: { in: ids } }, orderBy: { at: 'asc' } });
    // AuditEvent keeps the actor's id, not a relation: names are looked up once, for the trail.
    const actorIds = [...new Set(auditRows.map((a) => a.actorId).filter((id): id is string => id !== null))];
    const actors = actorIds.length
      ? await this.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = (id: string | null) => (id ? (actors.find((u) => u.id === id)?.name ?? id) : null);
    const releasedBy = document?.releasedById
      ? { id: document.releasedById, name: nameOf(document.releasedById) ?? document.releasedById }
      : null;

    return {
      today: this.clock.today(),
      returns: await this.returns(actor),
      lot: {
        id: lot.id,
        kind: lot.kind,
        title: lot.title,
        closedOn: lot.closedOn.toISOString().slice(0, 10),
        hammerCents: lot.hammerCents,
        buyer: { id: lot.buyerId, name: lot.buyer.displayName },
      },
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            amountCents: invoice.amountCents,
            dueOn: settlementDueOn(lot.closedOn.toISOString().slice(0, 10)),
            dueTime: SETTLEMENT_DUE_TIME,
          }
        : null,
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amountCents: payment.amountCents,
            stripePaymentIntentId: payment.stripePaymentIntentId,
            receivedAt: payment.receivedAt.toISOString(),
          }
        : null,
      document: document
        ? {
            id: document.id,
            kind: document.kind,
            status: document.status,
            eligibleAt: document.eligibleAt?.toISOString() ?? null,
            releasedAt: document.releasedAt?.toISOString() ?? null,
            releasedBy,
          }
        : null,
      funds,
      rule: { ...rule, policy: REGISTRATION_RELEASE_POLICY },
      sources: [
        {
          system: 'ledger',
          state: payment ? payment.status.toLowerCase() : 'no payment',
          note: payment ? `${payment.method.toLowerCase()} · ${payment.id}` : null,
        },
        {
          system: 'stripe',
          state: providerWord ?? 'no event',
          note: latestIntentEvent ? latestIntentEvent.externalId : null,
        },
        { system: 'document', state: document ? document.status.toLowerCase() : 'none', note: document?.id ?? null },
      ],
      conflict: conflict && !conflict.ok ? conflict : null,
      stripe: stripeRows.map((e) => ({
        eventId: e.externalId,
        type: e.type,
        status: e.status,
        receivedAt: e.receivedAt.toISOString(),
      })),
      audit: auditRows.map((a) => ({
        at: a.at.toISOString(),
        action: a.action,
        actor: nameOf(a.actorId),
        source: a.source,
        after: (a.after as Record<string, unknown> | null) ?? null,
        correlationId: a.correlationId,
      })),
    };
  }

  /** Every in-utero lot with the mare that carried it, and where she stands against the sale's return condition. */
  async returns(actor: Actor): Promise<InUteroReturn[]> {
    const today = this.clock.today();
    const lots = await this.db.saleLot.findMany({
      where: {
        kind: 'IN_UTERO',
        recipId: { not: null },
        ...(actor.role === 'CUSTOMER' ? { buyerId: actor.customerId ?? '__none__' } : {}),
      },
      include: {
        buyer: true,
        recip: {
          include: {
            clearances: {
              where: { kind: 'RETURN_ASSESSMENT' },
              orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
          },
        },
      },
      orderBy: { closedOn: 'desc' },
    });
    return lots.flatMap((lot) => {
      const recip = lot.recip;
      if (!recip) return [];
      const latest = recip.clearances[0] ?? null;
      const weanedOn = recip.weanedOn?.toISOString().slice(0, 10) ?? null;
      const returnedOn = recip.returnedOn?.toISOString().slice(0, 10) ?? null;
      const rule = evaluateRecipReturn(
        {
          recipId: recip.id,
          lotId: lot.id,
          weanedOn,
          returnedOn,
          assessment: latest
            ? {
                id: latest.id,
                kind: latest.kind,
                result: latest.result,
                performedOn: latest.performedOn.toISOString().slice(0, 10),
                expiresOn: latest.expiresOn?.toISOString().slice(0, 10) ?? null,
              }
            : null,
        },
        today,
      );
      const decision: InUteroReturn['decision'] = rule.ok
        ? 'CONDITION_MET'
        : rule.code === 'RETURN_ASSESSMENT_MISSING' || rule.code === 'RETURN_ASSESSMENT_PENDING'
          ? 'WAITING_ON_VET'
          : 'A_PERSON_DECIDES';
      return [
        {
          lot: {
            id: lot.id,
            title: lot.title,
            closedOn: lot.closedOn.toISOString().slice(0, 10),
            hammerCents: lot.hammerCents,
            buyer: { id: lot.buyerId, name: lot.buyer.displayName },
          },
          recip: { id: recip.id, number: recip.recipNumber, status: recip.recipStatus, weanedOn, returnedOn },
          assessment: latest
            ? {
                id: latest.id,
                result: latest.result,
                performedOn: latest.performedOn.toISOString().slice(0, 10),
                note: latest.note,
              }
            : null,
          rule,
          decision,
        },
      ];
    });
  }

  /**
   * Runs the release rule for a lot's invoice. Eligible documents are marked so — with the
   * rule's name and the evidence in the audit row — and announced. Nothing is released.
   */
  async reevaluate(invoiceId: string, correlationId: string | null, tx: Prisma.TransactionClient): Promise<void> {
    const lot = await tx.saleLot.findUnique({
      where: { invoiceId },
      include: { invoice: { include: { payments: true } }, documents: true },
    });
    if (!lot?.invoice) return;
    for (const document of lot.documents.filter((d) => d.status === 'HELD')) {
      const verdict = evaluateRegistrationRelease(
        { id: lot.id, documentId: document.id },
        { id: lot.invoice.id, amountCents: lot.invoice.amountCents, status: lot.invoice.status },
        lot.invoice.payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
      );
      if (!verdict.ok) continue;
      const eligibleAt = new Date();
      await tx.document.update({ where: { id: document.id }, data: { status: 'ELIGIBLE', eligibleAt } });
      await this.audit.record(
        {
          actor: null,
          source: 'JOB',
          action: 'document.eligible',
          entityType: 'Document',
          entityId: document.id,
          before: { status: 'HELD' },
          after: {
            status: 'ELIGIBLE',
            policy: REGISTRATION_RELEASE_POLICY,
            result: 'eligible',
            evidenceIds: verdict.evidenceIds,
            released: false,
          },
          correlationId: correlationId ?? undefined,
        },
        tx,
      );
      const payload: DocumentEligiblePayload = {
        documentId: document.id,
        lotId: lot.id,
        invoiceId: lot.invoice.id,
        policy: REGISTRATION_RELEASE_POLICY,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Document',
        aggregateId: document.id,
        type: BillingEvents.DocumentEligible,
        payload,
      });
      this.logger.log(`${document.id} eligible for release under ${REGISTRATION_RELEASE_POLICY}; not released`);
    }
  }

  /** The release rule again, after a return: an ELIGIBLE document goes back to HELD with the reason on the audit row. */
  async holdAgain(invoiceId: string, correlationId: string | null, tx: Prisma.TransactionClient): Promise<void> {
    const lot = await tx.saleLot.findUnique({
      where: { invoiceId },
      include: { invoice: { include: { payments: true } }, documents: true },
    });
    if (!lot?.invoice) return;
    for (const document of lot.documents.filter((d) => d.status === 'ELIGIBLE')) {
      const verdict = evaluateRegistrationRelease(
        { id: lot.id, documentId: document.id },
        { id: lot.invoice.id, amountCents: lot.invoice.amountCents, status: lot.invoice.status },
        lot.invoice.payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
      );
      if (verdict.ok) continue;
      await tx.document.update({ where: { id: document.id }, data: { status: 'HELD', eligibleAt: null } });
      await this.audit.record(
        {
          actor: null,
          source: 'JOB',
          action: 'document.held_again',
          entityType: 'Document',
          entityId: document.id,
          before: { status: 'ELIGIBLE' },
          after: {
            status: 'HELD',
            policy: REGISTRATION_RELEASE_POLICY,
            code: verdict.code,
            reason: verdict.reason,
            evidenceIds: verdict.evidenceIds,
          },
          correlationId: correlationId ?? undefined,
        },
        tx,
      );
      this.logger.log(`${document.id} held again under ${REGISTRATION_RELEASE_POLICY}: ${verdict.code}`);
    }
  }

  /** A person with billing rights sends the papers. The rule is asked one more time first. */
  async release(
    actor: Actor,
    documentId: string,
    note: string | null,
  ): Promise<{ documentId: string; status: 'RELEASED'; releasedAt: string }> {
    if (actor.role !== 'BILLING' && actor.role !== 'ADMIN')
      throw new ConflictException('only billing or an admin releases registration papers');
    const document = await this.db.document.findUnique({
      where: { id: documentId },
      include: { lot: { include: { invoice: { include: { payments: true } } } } },
    });
    if (!document) throw new NotFoundException(`${documentId} not found`);
    if (document.status === 'RELEASED') throw new ConflictException(`${documentId} was already released`);
    const invoice = document.lot.invoice;
    if (!invoice) throw new ConflictException(`${document.lot.id} has no invoice; nothing can clear`);
    const verdict = evaluateRegistrationRelease(
      { id: document.lot.id, documentId: document.id },
      { id: invoice.id, amountCents: invoice.amountCents, status: invoice.status },
      invoice.payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
    );
    if (!verdict.ok)
      throw new ConflictException({ code: verdict.code, message: verdict.reason, evidenceIds: verdict.evidenceIds });
    const releasedAt = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: 'RELEASED',
          releasedAt,
          releasedById: actor.userId,
          note,
          eligibleAt: document.eligibleAt ?? releasedAt,
        },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'document.released',
          entityType: 'Document',
          entityId: documentId,
          before: { status: document.status },
          after: { status: 'RELEASED', policy: REGISTRATION_RELEASE_POLICY, evidenceIds: verdict.evidenceIds, note },
        },
        tx,
      );
    });
    return { documentId, status: 'RELEASED', releasedAt: releasedAt.toISOString() };
  }

  // ───────────────────────────── the two controls on the settlement page ─────────────────────────────

  /**
   * The bank finishes moving the money: Stripe would send `payment_intent.succeeded` for the
   * ACH intent. The simulated delivery takes the real path — inbox, job, ledger, event,
   * consumer — so the document becomes eligible the way it would in production.
   */
  async settleAch(actor: Actor, lotId: string): Promise<{ eventId: string; paymentId: string; mode: string }> {
    const lot = await this.db.saleLot.findUnique({
      where: { id: lotId },
      include: { invoice: { include: { payments: true } } },
    });
    if (!lot?.invoice) throw new NotFoundException(`${lotId} has no invoice`);
    const payment = lot.invoice.payments.find((p) => p.status === 'PROCESSING' || p.status === 'PENDING');
    if (!payment) throw new ConflictException(`${lotId}: no payment is in flight; nothing to settle`);
    const intentId = payment.stripePaymentIntentId ?? `pi_sim_${payment.id.toLowerCase().replace(/-/g, '')}`;
    if (!payment.stripePaymentIntentId) {
      // The ledger row must name the intent the event names, or the inbox would create a second payment.
      await this.db.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intentId } });
    }
    const eventId = `evt_settle_${payment.id.toLowerCase().replace(/-/g, '')}_${Date.now().toString(36)}`;
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'settlement.simulated',
      entityType: 'Payment',
      entityId: payment.id,
      after: { eventId, lotId, method: payment.method },
    });
    const outcome = await this.payments.ingestStripeEvent(
      {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: intentId,
            object: 'payment_intent',
            amount: payment.amountCents,
            status: 'succeeded',
            metadata: { invoiceId: lot.invoice.id, customerId: lot.buyerId, method: payment.method },
          },
        },
      },
      true,
    );
    return { eventId, paymentId: payment.id, mode: outcome.mode };
  }

  /**
   * A source conflict, as it happens in the wild: a late, out-of-order `processing` delivery
   * lands after the ledger already knows the payment succeeded. The forward-only rule keeps
   * the ledger right; the inbox now holds a provider word that disagrees with it, and the
   * detector raises the disagreement for a person. Labeled a simulation in the audit trail.
   */
  async createSourceConflict(actor: Actor, lotId: string): Promise<{ eventId: string; paymentId: string }> {
    const lot = await this.db.saleLot.findUnique({
      where: { id: lotId },
      include: { invoice: { include: { payments: true } } },
    });
    if (!lot?.invoice) throw new NotFoundException(`${lotId} has no invoice`);
    const payment = lot.invoice.payments.find((p) => p.status === 'SUCCEEDED');
    if (!payment)
      throw new ConflictException(
        `${lotId}: the ledger does not hold a succeeded payment; settle first, then create the conflict`,
      );
    const intentId = payment.stripePaymentIntentId ?? `pi_sim_${payment.id.toLowerCase().replace(/-/g, '')}`;
    const eventId = `evt_late_${payment.id.toLowerCase().replace(/-/g, '')}_${Date.now().toString(36)}`;
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'settlement.conflict_simulated',
      entityType: 'Payment',
      entityId: payment.id,
      after: { eventId, lotId, note: 'a late processing event delivered after succeeded' },
    });
    await this.payments.ingestStripeEvent(
      {
        id: eventId,
        type: 'payment_intent.processing',
        data: {
          object: {
            id: intentId,
            object: 'payment_intent',
            amount: payment.amountCents,
            status: 'processing',
            metadata: { invoiceId: lot.invoice.id, customerId: lot.buyerId, method: payment.method },
          },
        },
      },
      true,
    );
    return { eventId, paymentId: payment.id };
  }
}

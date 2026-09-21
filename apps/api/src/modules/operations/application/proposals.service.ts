import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { can, type Actor } from '@daysheet/domain';
import type { Prisma, ProposalKind, ProposalStatus } from '@daysheet/db';
import { z } from 'zod';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { TransfersService } from '../../reproduction/application/transfers.service';
import { OperationsEvents, type ProposalDecidedPayload } from '../domain/events';
import { EXCEPTIONS } from '../domain/exceptions';
import { PROPOSAL_KINDS } from '../domain/proposals';
import {
  decisionDiff,
  departureLines,
  departureVerdict,
  plannedRecipientLines,
  type DecisionDiff,
} from '../domain/diff';
import { RequestsService } from './requests.service';

/**
 * The assistant may propose; a person decides; the domain rule executes.
 *
 * A proposal is a row until someone with the right role approves it. Approval does not
 * trust the proposal: it runs the same call the UI would (`assignPlannedRecipient`, or the
 * request row "Send to team" writes), so an approved proposal the rule refuses stays refused,
 * with the rule's reason on the record. Before anything runs, approval checks that the records
 * the proposal was made from have not moved (`stateHash`); a stale proposal is marked STALE,
 * nothing runs, and the question is asked again if still wanted. Money and medical results are
 * never proposal kinds; the policy layer answers those before a token is spent.
 */
export const ProposalPayloads = {
  ASSIGN_PLANNED_RECIPIENT: z.object({
    embryoId: z.string(),
    recipientId: z.string(),
  }),
  REQUEST_VETERINARY_CONFIRMATION: z.object({
    recipId: z.string(),
    subject: z.string().min(3).max(200),
    body: z.string().min(3).max(2_000),
  }),
} as const satisfies Record<ProposalKind, z.ZodTypeAny>;

export type ProposalPayload<K extends ProposalKind> = z.infer<(typeof ProposalPayloads)[K]>;
type Decision = Extract<ProposalStatus, 'APPROVED' | 'DECLINED' | 'STALE'>;

/** What a person may change at approval: the words of a request, never its subject or target. */
export interface ApprovalEdits {
  body?: string;
  note?: string;
}

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transfers: TransfersService,
    private readonly outbox: OutboxService,
    private readonly requests: RequestsService,
    private readonly clock: ClockService,
    private readonly codes: CodesService,
  ) {}

  /**
   * The decision as a diff, for a person to read before the click: the rows a yes would change
   * and the ones it reads, from exactly the reads the fingerprint binds; the rule's verdict as it
   * stands; who may say yes. The board's line applies. Read-only: nothing here runs the rule for
   * real — approval does, in its own transaction.
   */
  async diff(actor: Actor, id: string): Promise<DecisionDiff> {
    if (!can(actor, 'read', 'operations')) throw new ForbiddenException('a decision is read by staff');
    const row = await this.db.proposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`proposal ${id} not found`);
    const stateHashNow = await this.stateHashFor(row.kind, row.payload);
    switch (row.kind) {
      case 'ASSIGN_PLANNED_RECIPIENT': {
        const payload = ProposalPayloads.ASSIGN_PLANNED_RECIPIENT.parse(row.payload);
        const [read, verdict] = await Promise.all([
          this.transfers.plannedRecipientRead(payload.embryoId, payload.recipientId),
          this.transfers.plannedRecipientFor(payload.embryoId, payload.recipientId),
        ]);
        return decisionDiff({
          proposalId: row.id,
          kind: row.kind,
          status: row.status,
          subject: payload.recipientId,
          stateHashAtProposal: row.stateHash,
          stateHashNow,
          lines: plannedRecipientLines(payload, read),
          rule: {
            code: verdict.ok ? 'RECIPIENT_OK' : verdict.code,
            label: 'PlannedRecipientRule',
            verdict: verdict.ok ? 'ok' : 'blocked',
            reason: verdict.ok ? null : verdict.reason,
          },
        });
      }
      case 'REQUEST_VETERINARY_CONFIRMATION': {
        const payload = ProposalPayloads.REQUEST_VETERINARY_CONFIRMATION.parse(row.payload);
        const [read, pending] = await Promise.all([
          this.transfers.departureRead(payload.recipId),
          this.requests.openAbout(payload.recipId),
        ]);
        const verdict = departureVerdict(payload.recipId, read, this.clock.today());
        return decisionDiff({
          proposalId: row.id,
          kind: row.kind,
          status: row.status,
          subject: payload.recipId,
          stateHashAtProposal: row.stateHash,
          stateHashNow,
          lines: departureLines(payload, read, pending),
          rule: verdict
            ? {
                code: verdict.ok ? 'DEPARTURE_OK' : verdict.code,
                label: 'DepartureRule',
                verdict: verdict.ok ? 'ok' : 'blocked',
                reason: verdict.ok ? null : verdict.reason,
              }
            : null,
        });
      }
    }
  }

  /** The decision, as a fact, inside the decider's transaction: the row, the audit line and the event; the review graph resumes on it after the commit. */
  private async decided(
    tx: Prisma.TransactionClient,
    actor: Actor,
    id: string,
    kind: string,
    askMessageId: string | null,
    status: Decision,
    decision: string,
    action: string,
    after: unknown,
    result?: unknown,
  ): Promise<void> {
    // The row moves out of PROPOSED exactly once; the lock in `claim` makes a second click wait, and this makes it lose.
    const moved = await tx.proposal.updateMany({
      where: { id, status: 'PROPOSED' },
      data: {
        status,
        decidedById: actor.userId,
        decidedAt: new Date(),
        decision,
        ...(result !== undefined ? { result: result as never } : {}),
      },
    });
    if (moved.count === 0)
      throw new ConflictException({
        code: 'ALREADY_DECIDED',
        message: `proposal ${id} was decided by someone else a moment ago`,
      });
    await this.audit.record(
      {
        actor,
        source: 'UI',
        action,
        entityType: 'Proposal',
        entityId: id,
        after,
      },
      tx,
    );
    const payload: ProposalDecidedPayload = {
      proposalId: id,
      kind,
      status,
      decision,
      decidedBy: actor.userId,
      askMessageId,
    };
    await this.outbox.append(tx, {
      aggregateType: 'Proposal',
      aggregateId: id,
      type: OperationsEvents.ProposalDecided,
      payload,
    });
  }

  /**
   * One decision at a time per proposal: the row is locked for the length of the deciding
   * transaction, so two people clicking at once are served in turn — the second finds the row
   * already decided and is told so, and nothing runs twice.
   */
  private async claim(tx: Prisma.TransactionClient, id: string) {
    const locked = await tx.$queryRaw<
      { status: ProposalStatus }[]
    >`SELECT "status" FROM "Proposal" WHERE "id" = ${id} FOR UPDATE`;
    const status = locked[0]?.status;
    if (!status) throw new NotFoundException(`proposal ${id} not found`);
    if (status !== 'PROPOSED')
      throw new ConflictException({
        code: 'ALREADY_DECIDED',
        message: `proposal ${id} is already ${status.toLowerCase()}`,
      });
    return tx.proposal.findUniqueOrThrow({ where: { id } });
  }

  /** The decision's transaction, then the outbox flush the graph resumes on. */
  private async deciding<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const outcome = await this.db.$transaction(work, { timeout: 20_000 });
    await this.outbox.flush();
    return outcome;
  }

  private get db() {
    return this.prisma.client;
  }

  async propose(
    actor: Actor,
    kind: ProposalKind,
    payload: unknown,
    rationale: string,
    evidenceIds: string[],
    askMessageId: string | null = null,
  ) {
    const parsed = ProposalPayloads[kind].safeParse(payload);
    if (!parsed.success)
      throw new BadRequestException(
        `proposal payload for ${kind} is malformed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    const stateHash = await this.stateHashFor(kind, parsed.data);
    // A code like every record a person cites (DEC-26-0041), from the atomic sequence, never a row count.
    const id = await this.codes.next('proposal', Number(this.clock.today().slice(0, 4)));
    const row = await this.db.proposal.create({
      data: {
        id,
        kind,
        payload: parsed.data,
        rationale: rationale.slice(0, 600),
        evidenceIds,
        proposedByUserId: actor.userId,
        askMessageId,
        stateHash,
      },
    });
    await this.audit.record({
      actor,
      source: 'AI',
      action: 'proposal.created',
      entityType: 'Proposal',
      entityId: row.id,
      after: { kind, payload: parsed.data, evidenceIds, stateHash },
    });
    return row;
  }

  async approve(actor: Actor, id: string, edits: ApprovalEdits = {}) {
    return this.deciding(async (tx) => {
      const row = await this.claim(tx, id);
      const spec = PROPOSAL_KINDS[row.kind];
      if (!can(actor, 'write', spec.approver))
        throw new ForbiddenException(`${actor.role} may not approve a ${row.kind.toLowerCase()} proposal`);
      // A proposal is bound to the records it was made from. If they moved in between — another
      // hold, a transfer, a video recorded, the same request already sent — the person is approving
      // something they were not shown: it is refused before anything runs, and the row says so.
      const stateNow = await this.stateHashFor(row.kind, row.payload);
      if (row.stateHash !== null && row.stateHash !== stateNow) {
        const reason = 'the records changed after it was proposed; review the current evidence and ask again';
        await this.decided(
          tx,
          actor,
          id,
          row.kind,
          row.askMessageId,
          'STALE',
          `approved by ${actor.role}, refused as stale: ${reason}`,
          'proposal.stale',
          { proposedState: row.stateHash, currentState: stateNow },
        );
        return {
          status: 'STALE' as const,
          code: 'PROPOSAL_STALE' as const,
          reason,
        };
      }
      const edited = typeof edits.body === 'string' && edits.body.trim().length > 0;
      const how = `approved${edited ? ' with an edit' : ''}${edits.note ? ` — ${edits.note.slice(0, 300)}` : ''}`;
      switch (row.kind) {
        case 'ASSIGN_PLANNED_RECIPIENT': {
          const payload = ProposalPayloads.ASSIGN_PLANNED_RECIPIENT.parse(row.payload);
          try {
            const result = await this.transfers.assignPlannedRecipient(
              actor,
              payload.embryoId,
              payload.recipientId,
              'AI',
            );
            await this.decided(
              tx,
              actor,
              id,
              row.kind,
              row.askMessageId,
              'APPROVED',
              `${how}; the rule accepted it`,
              'proposal.approved',
              result,
              result,
            );
            return { status: 'APPROVED' as const, result };
          } catch (error) {
            // The person said yes; the rule said no. The rule wins, and the record says why.
            const reason = (error as { response?: { message?: string } }).response?.message ?? (error as Error).message;
            await this.decided(
              tx,
              actor,
              id,
              row.kind,
              row.askMessageId,
              'DECLINED',
              `${how}, refused by the rule: ${reason}`,
              'proposal.refused_by_rule',
              { reason },
            );
            return {
              status: 'DECLINED' as const,
              code: 'REFUSED_BY_RULE' as const,
              reason,
            };
          }
        }
        case 'REQUEST_VETERINARY_CONFIRMATION': {
          const payload = ProposalPayloads.REQUEST_VETERINARY_CONFIRMATION.parse(row.payload);
          // The rule for this kind: one open request per subject. A person can approve; the rule still says no.
          const pending = (await this.requests.openAbout(payload.recipId)).find((r) => r.subject === payload.subject);
          if (pending) {
            const reason = `a request with this subject is already open (${pending.id}); nothing was sent twice`;
            await this.decided(
              tx,
              actor,
              id,
              row.kind,
              row.askMessageId,
              'DECLINED',
              `${how}, refused by the rule: ${reason}`,
              'proposal.refused_by_rule',
              { reason, requestId: pending.id },
            );
            return {
              status: 'DECLINED' as const,
              code: 'REFUSED_BY_RULE' as const,
              reason,
            };
          }
          const body = edited ? (edits.body ?? '').trim().slice(0, 2_000) : payload.body;
          // The same row "Send to team" writes, with the approver's name on it — never the assistant's; in the same transaction as the decision, so neither exists without the other.
          const request = await this.requests.create(
            actor,
            {
              subject: payload.subject,
              body,
              evidenceIds: Array.from(new Set([payload.recipId, ...row.evidenceIds])),
            },
            'UI',
            tx,
          );
          const result = {
            requestId: request.id,
            subject: request.subject,
            body,
            edited,
          };
          await this.decided(
            tx,
            actor,
            id,
            row.kind,
            row.askMessageId,
            'APPROVED',
            `${how}; the request went to the team`,
            'proposal.approved',
            result,
            result,
          );
          return { status: 'APPROVED' as const, result };
        }
      }
    });
  }

  /** The fingerprint of what the executing call reads, per kind. */
  private async stateHashFor(kind: ProposalKind, payload: unknown): Promise<string> {
    switch (kind) {
      case 'ASSIGN_PLANNED_RECIPIENT': {
        const { embryoId, recipientId } = ProposalPayloads.ASSIGN_PLANNED_RECIPIENT.parse(payload);
        return this.transfers.plannedRecipientStateHash(embryoId, recipientId);
      }
      case 'REQUEST_VETERINARY_CONFIRMATION': {
        const { recipId } = ProposalPayloads.REQUEST_VETERINARY_CONFIRMATION.parse(payload);
        // Her departure state, and whether a request about her is already open: sending it twice is a change too.
        const [state, pending] = await Promise.all([
          this.transfers.departureStateHash(recipId),
          this.requests.openAbout(recipId),
        ]);
        return createHash('sha256')
          .update(JSON.stringify({ state, pending: pending.map((r) => r.id) }))
          .digest('hex')
          .slice(0, 16);
      }
    }
  }

  async decline(actor: Actor, id: string, note: string) {
    return this.deciding(async (tx) => {
      const row = await this.claim(tx, id);
      await this.decided(tx, actor, id, row.kind, row.askMessageId, 'DECLINED', note, 'proposal.declined', { note });
      return { status: 'DECLINED' as const };
    });
  }

  async list(status: ProposalStatus | 'all' = 'PROPOSED') {
    const rows = await this.db.proposal.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.withSpec(row));
  }

  async get(id: string) {
    const row = await this.db.proposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`proposal ${id} not found`);
    return this.withSpec(row);
  }

  /** The proposals an answer made, with the catalog's words, in the order the ids came. */
  async byIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db.proposal.findMany({ where: { id: { in: ids } } });
    return rows.map((row) => this.withSpec(row));
  }

  /** What became of the proposals stamped onto one answer: oldest first, so the last is the latest. */
  async forMessage(
    askMessageId: string,
  ): Promise<{ id: string; kind: ProposalKind; status: ProposalStatus; decidedAt: Date | null }[]> {
    return this.db.proposal.findMany({
      where: { askMessageId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, status: true, decidedAt: true },
    });
  }

  /**
   * The decision ledger for one proposal: the signal that started it, what the assistant looked
   * at, the proposal, the person's decision, what ran, and what became of it — every line a row
   * with its time. Nothing is inferred: a step without a row is absent, not filled in.
   */
  /**
   * One decision's ledger, projected — never stored twice: the proposal row, its audit lines, the
   * signals about its subject and the request it sent are read as they are, and every event points
   * at the row it comes from. Prepared, approved, executed and the outcome are four different
   * facts: sending a request is executed; the mare's question is still open until the signal that
   * started this closes, and until then the outcome is awaited, not claimed.
   */
  async ledger(actor: Actor, id: string) {
    if (!can(actor, 'read', 'operations')) throw new ForbiddenException('a decision is read by staff');
    const row = await this.db.proposal.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`proposal ${id} not found`);
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const result = (row.result ?? null) as Record<string, unknown> | null;
    const subjectIds = Array.from(
      new Set([
        ...row.evidenceIds,
        ...['recipId', 'embryoId', 'recipientId']
          .map((k) => payload[k])
          .filter((v): v is string => typeof v === 'string'),
      ]),
    );
    const [people, message, audit, exceptions, request] = await Promise.all([
      this.db.user.findMany({
        where: {
          id: {
            in: [row.proposedByUserId, ...(row.decidedById ? [row.decidedById] : [])],
          },
        },
        select: { id: true, name: true, role: true },
      }),
      row.askMessageId
        ? this.db.askMessage.findUnique({
            where: { id: row.askMessageId },
            include: {
              conversation: {
                include: {
                  messages: {
                    where: { role: 'USER' },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          })
        : Promise.resolve(null),
      this.db.auditEvent.findMany({
        where: { entityType: 'Proposal', entityId: id },
        orderBy: { at: 'asc' },
      }),
      subjectIds.length > 0
        ? this.db.operationalException.findMany({
            where: { entityId: { in: subjectIds } },
            orderBy: { createdAt: 'asc' },
            take: 20,
          })
        : Promise.resolve([]),
      typeof result?.['requestId'] === 'string'
        ? this.db.request.findUnique({ where: { id: result['requestId'] } })
        : Promise.resolve(null),
    ]);
    // The question that started the run which prepared this: the last of the person's messages before the answer.
    const asked = message
      ? await this.db.askMessage.findFirst({
          where: { conversationId: message.conversationId, role: 'USER', createdAt: { lte: message.createdAt } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : null;
    const requestClosed = request
      ? await this.db.auditEvent.findFirst({
          where: {
            entityType: 'Request',
            entityId: request.id,
            action: 'request.closed',
          },
          orderBy: { at: 'desc' },
        })
      : null;
    const who = (userId: string | null) =>
      userId
        ? (people.find((p) => p.id === userId) ?? {
            id: userId,
            name: 'unknown user',
            role: 'unknown',
          })
        : null;
    const calls = (Array.isArray(message?.toolCalls) ? message.toolCalls : []) as {
      name: string;
      ok: boolean;
      idsReturned: string[];
      durationMs: number;
    }[];
    const spec = PROPOSAL_KINDS[row.kind];

    // The signals about the subject: the earliest open at the time is where this began. The outcome is that
    // signal — or one of its kind about the same subject — closing after the decision. Any other row resolving
    // (the books catching up on an invoice) is not this decision's outcome.
    const signalsBefore = exceptions.filter((x) => x.createdAt <= row.createdAt);
    // Only a signal that was open when this was prepared is where it began; one resolved before then is history.
    const started = [...signalsBefore].reverse().find((x) => !x.resolvedAt || x.resolvedAt > row.createdAt) ?? null;
    const resolvedAfter =
      exceptions
        .filter(
          (x) =>
            x.resolvedAt &&
            x.resolvedAt > row.createdAt &&
            started !== null &&
            x.kind === started.kind &&
            x.entityId === started.entityId,
        )
        .sort((a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0))[0] ?? null;

    type Step = {
      at: string;
      kind: 'signal' | 'investigated' | 'prepared' | 'decided' | 'executed' | 'outcome';
      label: string;
      detail: string;
      by: { name: string; role: string } | null;
      ref: string | null;
      /** One word for the row's result: what a glance needs; the provenance is behind a click. */
      result:
        | 'open'
        | 'read'
        | 'prepared'
        | 'approved'
        | 'declined'
        | 'stale'
        | 'refused'
        | 'executed'
        | 'done'
        | 'resolved'
        | 'awaiting';
      provenance: {
        evidenceIds: string[];
        stateHash: string | null;
        rule: string | null;
        correlationId: string | null;
        executionRef: string | null;
        auditId: string | null;
      };
    };
    const auditFor = (action: string) => audit.find((a) => a.action === action) ?? null;
    const created = auditFor('proposal.created');
    const decidedAudit =
      audit.find((a) =>
        ['proposal.approved', 'proposal.declined', 'proposal.stale', 'proposal.refused_by_rule'].includes(a.action),
      ) ?? null;
    const startedDetail = (started?.detail ?? null) as { code?: unknown } | null;
    const timeline: Step[] = [];
    if (started)
      timeline.push({
        at: started.createdAt.toISOString(),
        kind: 'signal',
        label: 'Signal detected',
        detail: started.title,
        by: null,
        ref: started.id,
        result: started.resolvedAt ? 'resolved' : 'open',
        provenance: {
          evidenceIds: started.entityId ? [started.entityId] : [],
          stateHash: null,
          rule: typeof startedDetail?.code === 'string' ? startedDetail.code : null,
          correlationId: started.correlationId,
          executionRef: null,
          auditId: null,
        },
      });
    if (message) {
      const records = new Set(calls.flatMap((c) => c.idsReturned)).size;
      // The investigation began when the question was asked; the answer row is written after the tools ran,
      // which is after the proposal the tools prepared.
      timeline.push({
        at: (asked?.createdAt ?? message.createdAt).toISOString(),
        kind: 'investigated',
        label: 'Investigated',
        detail: `${calls.length} tool call${calls.length === 1 ? '' : 's'} · ${records} record${records === 1 ? '' : 's'} read · ${message.model ?? 'no model'}`,
        by: null,
        ref: message.id,
        result: 'read',
        provenance: {
          evidenceIds: message.evidenceIds,
          stateHash: message.contextVersion ?? null,
          rule: null,
          correlationId: null,
          executionRef: null,
          auditId: null,
        },
      });
    }
    timeline.push({
      at: row.createdAt.toISOString(),
      kind: 'prepared',
      label: 'Prepared',
      detail: `${spec.label}: ${spec.after(payload)}`,
      by: who(row.proposedByUserId),
      ref: row.id,
      result: 'prepared',
      provenance: {
        evidenceIds: row.evidenceIds,
        stateHash: row.stateHash,
        rule: null,
        correlationId: created?.correlationId ?? null,
        executionRef: null,
        auditId: created?.id ?? null,
      },
    });
    if (row.decidedAt) {
      const label =
        row.status === 'APPROVED'
          ? row.decision?.includes('with an edit')
            ? 'Approved with an edit'
            : 'Approved'
          : row.status === 'STALE'
            ? 'Refused as stale'
            : row.decision?.includes('refused by the rule')
              ? 'Approved, refused by the rule'
              : 'Rejected';
      const decidedAfter = (decidedAudit?.after ?? null) as Record<string, unknown> | null;
      timeline.push({
        at: row.decidedAt.toISOString(),
        kind: 'decided',
        label,
        detail: row.decision ?? '',
        by: who(row.decidedById),
        ref: row.id,
        result:
          row.status === 'APPROVED'
            ? 'approved'
            : row.status === 'STALE'
              ? 'stale'
              : row.decision?.includes('refused by the rule')
                ? 'refused'
                : 'declined',
        provenance: {
          evidenceIds: row.evidenceIds,
          // A stale refusal names both fingerprints; an approval ran on equality, so the proposal's own is the one it checked.
          stateHash:
            typeof decidedAfter?.['currentState'] === 'string'
              ? `${row.stateHash ?? '—'} → ${String(decidedAfter['currentState'])}`
              : row.stateHash,
          rule: typeof decidedAfter?.['code'] === 'string' ? String(decidedAfter['code']) : null,
          correlationId: decidedAudit?.correlationId ?? null,
          executionRef: null,
          auditId: decidedAudit?.id ?? null,
        },
      });
    }
    if (row.status === 'APPROVED' && result) {
      const detail = request
        ? `Request sent to the team: “${request.subject}”`
        : row.kind === 'ASSIGN_PLANNED_RECIPIENT'
          ? `${String(payload['recipientId'])} held for ${String(payload['embryoId'])}`
          : 'executed';
      const executionRef =
        request?.id ?? (row.kind === 'ASSIGN_PLANNED_RECIPIENT' ? String(payload['embryoId']) : null);
      // The request is written inside the deciding transaction, a few milliseconds before the row is stamped decided;
      // the decision is what ran it, so it never reads as earlier.
      const ranAt =
        [request?.createdAt, row.decidedAt, row.createdAt]
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? row.createdAt;
      timeline.push({
        at: ranAt.toISOString(),
        kind: 'executed',
        label: 'Executed',
        detail,
        by: who(row.decidedById),
        ref: executionRef,
        result: 'executed',
        provenance: {
          evidenceIds: Array.isArray(result?.['evidenceIds']) ? (result['evidenceIds'] as string[]) : [],
          stateHash: row.stateHash,
          rule: spec.executes,
          correlationId: decidedAudit?.correlationId ?? null,
          executionRef,
          auditId: decidedAudit?.id ?? null,
        },
      });
    }
    if (requestClosed)
      timeline.push({
        at: requestClosed.at.toISOString(),
        kind: 'outcome',
        label: 'Request marked done',
        detail:
          typeof (requestClosed.after as { note?: unknown } | null)?.note === 'string'
            ? String((requestClosed.after as { note: string }).note)
            : 'closed by a person',
        by: who(requestClosed.actorId),
        ref: request?.id ?? null,
        result: 'done',
        provenance: {
          evidenceIds: request ? [request.id] : [],
          stateHash: null,
          rule: null,
          correlationId: requestClosed.correlationId,
          executionRef: request?.id ?? null,
          auditId: requestClosed.id,
        },
      });
    if (resolvedAfter?.resolvedAt)
      timeline.push({
        at: resolvedAfter.resolvedAt.toISOString(),
        kind: 'outcome',
        label: 'Signal resolved',
        detail: resolvedAfter.resolution ?? resolvedAfter.title,
        by: null,
        ref: resolvedAfter.id,
        result: 'resolved',
        provenance: {
          evidenceIds: resolvedAfter.entityId ? [resolvedAfter.entityId] : [],
          stateHash: null,
          rule: null,
          correlationId: resolvedAfter.correlationId,
          executionRef: null,
          auditId: null,
        },
      });
    const RANK: Record<Step['kind'], number> = {
      signal: 0,
      investigated: 1,
      prepared: 2,
      decided: 3,
      executed: 4,
      outcome: 5,
    };
    timeline.sort((a, b) => a.at.localeCompare(b.at) || RANK[a.kind] - RANK[b.kind]);

    const stale = audit.find((a) => a.action === 'proposal.stale');
    const currentState = await this.stateHashFor(row.kind, row.payload).catch(() => null);
    // Approval already compared the fingerprints and ran only on equality, so an approved row's records were as
    // shown at the click; what moved since is its own doing (the request it sent). A waiting row is compared live.
    const moved =
      row.status === 'STALE'
        ? true
        : row.status === 'APPROVED'
          ? false
          : row.stateHash !== null && currentState !== null && row.stateHash !== currentState;
    return {
      proposal: this.withSpec(row),
      people: {
        proposedBy: who(row.proposedByUserId),
        decidedBy: who(row.decidedById),
      },
      question: message?.conversation.messages[0]?.content.slice(0, 300) ?? null,
      investigation: message
        ? {
            messageId: message.id,
            at: message.createdAt.toISOString(),
            model: message.model,
            latencyMs: message.latencyMs,
            toolCalls: calls.map((c) => ({
              name: c.name,
              ok: c.ok,
              records: c.idsReturned.length,
              durationMs: c.durationMs,
            })),
            evidenceIds: message.evidenceIds,
          }
        : null,
      evidence: {
        ids: subjectIds,
        stateHashAtProposal: row.stateHash,
        stateHashNow: currentState,
        moved,
        staleDetail: stale ? (stale.after as Record<string, unknown> | null) : null,
      },
      signals: exceptions.map((x) => ({
        id: x.id,
        kind: x.kind,
        status: x.status,
        title: x.title,
        createdAt: x.createdAt.toISOString(),
        resolvedAt: x.resolvedAt?.toISOString() ?? null,
      })),
      request: request
        ? {
            id: request.id,
            subject: request.subject,
            body: request.body,
            status: request.status,
            createdAt: request.createdAt.toISOString(),
          }
        : null,
      outcome: resolvedAfter
        ? {
            state: 'verified' as const,
            label: 'resolved · the signal this began with closed',
            ref: resolvedAfter.id,
            at: resolvedAfter.resolvedAt?.toISOString() ?? null,
          }
        : row.status === 'APPROVED'
          ? {
              state: 'awaiting' as const,
              label:
                started && !started.resolvedAt
                  ? `awaiting outcome · ${EXCEPTIONS[started.kind].label.toLowerCase()} still open`
                  : 'awaiting outcome · nothing on the board confirms it yet',
              ref: started?.id ?? null,
              at: null,
            }
          : row.status === 'PROPOSED'
            ? { state: 'none' as const, label: 'waiting for a person', ref: null, at: null }
            : {
                state: 'none' as const,
                label: row.status === 'STALE' ? 'refused as stale · nothing ran' : 'declined · nothing ran',
                ref: null,
                at: null,
              },
      summary: {
        decisionId: row.id,
        subject: subjectIds[0] ?? null,
        kind: row.kind,
        status: row.status,
        evidenceFingerprint: row.stateHash,
        createdAt: row.createdAt.toISOString(),
        proposedBy: who(row.proposedByUserId),
        decidedBy: who(row.decidedById),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decision: row.decision,
        edit:
          typeof result?.['editedBody'] === 'string'
            ? String(result['editedBody'])
            : row.decision?.includes('with an edit')
              ? 'the body was edited before it was sent'
              : null,
        executedAt:
          row.status === 'APPROVED' && result
            ? (request?.createdAt ?? row.decidedAt ?? row.createdAt).toISOString()
            : null,
        executionRef:
          row.status === 'APPROVED' && result
            ? (request?.id ?? (row.kind === 'ASSIGN_PLANNED_RECIPIENT' ? String(payload['embryoId']) : null))
            : null,
      },
      timeline,
    };
  }

  /** The catalog as data: what each kind executes, who approves, what it will never do. */
  kinds() {
    return Object.values(PROPOSAL_KINDS).map((spec) => ({
      kind: spec.kind,
      label: spec.label,
      executes: spec.executes,
      approver: spec.approver,
      riskClass: spec.riskClass,
      willNot: spec.willNot,
    }));
  }

  async stamp(ids: string[], askMessageId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.proposal.updateMany({
      where: { id: { in: ids } },
      data: { askMessageId },
    });
  }

  /** A row with the catalog's words for it: the label, the before and after, what it will not do. */
  private withSpec<T extends { kind: ProposalKind; payload: unknown }>(row: T) {
    const spec = PROPOSAL_KINDS[row.kind];
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      ...row,
      spec: {
        label: spec.label,
        executes: spec.executes,
        approver: spec.approver,
        riskClass: spec.riskClass,
        willNot: spec.willNot,
        before: spec.before(payload),
        after: spec.after(payload),
      },
    };
  }
}

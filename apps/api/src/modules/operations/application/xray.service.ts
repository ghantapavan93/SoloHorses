import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Actor } from '@daysheet/domain';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { StoryService } from '../../reproduction/application/story.service';
import { EXCEPTIONS } from '../domain/exceptions';
import { SIGNAL_SHAPES } from '../domain/signals';
import { xrayFor, type Xray, type XraySignal } from '../domain/xray';
import { ExceptionsService } from './exceptions.service';
import { RequestsService } from './requests.service';

/**
 * One mare's evidence graph, from the same read models the story and the board already use:
 * the story for her records and the rules' verdicts, the board for every open signal about
 * her. Nothing is stored; the graph is the state at the moment of the request, fingerprinted.
 */
@Injectable()
export class XrayService {
  constructor(
    private readonly stories: StoryService,
    private readonly exceptions: ExceptionsService,
    private readonly clock: ClockService,
    private readonly prisma: PrismaService,
    private readonly requests: RequestsService,
  ) {}

  /**
   * The x-ray a decision opens on: the mare it is about — named on the row, or reached through
   * the embryo's planned or carrying recipient — lit at that decision. The board's line applies:
   * a customer has no board and sees no evidence graph. Null when the decision has no mare behind
   * it (a books signal about an invoice, a dead job); the page then shows the signal alone.
   */
  async forSignal(actor: Actor, signalId: string): Promise<Xray | null> {
    if (!can(actor, 'read', 'operations')) throw new ForbiddenException('the evidence graph is read by staff');
    const row = await this.prisma.client.operationalException.findUnique({
      where: { id: signalId },
      select: { id: true, entityId: true, detail: true },
    });
    if (!row) throw new NotFoundException(`${signalId} not found`);
    const recipId = await this.subjectRecipFor(row.entityId, row.detail as Record<string, unknown> | null);
    if (!recipId) return null;
    return this.build(actor, recipId, signalId);
  }

  private async subjectRecipFor(
    entityId: string | null,
    detail: Record<string, unknown> | null,
  ): Promise<string | null> {
    const named = typeof detail?.['recipId'] === 'string' ? detail['recipId'] : null;
    const candidate = named ?? entityId;
    if (!candidate) return null;
    if (candidate.startsWith('R-')) return candidate;
    if (candidate.startsWith('E-')) {
      const embryo = await this.prisma.client.embryo.findUnique({
        where: { id: candidate },
        select: {
          plannedRecipientId: true,
          transfers: {
            select: { recipientId: true },
            orderBy: { performedOn: 'desc' },
            take: 1,
          },
        },
      });
      return embryo?.transfers[0]?.recipientId ?? embryo?.plannedRecipientId ?? null;
    }
    return null;
  }

  /** The mare the front door tells the story of: her x-ray has a page, the others are read through the tool. */
  storyRecipId(): Promise<string> {
    return this.stories.storyRecipId();
  }

  /**
   * `focus` is a signal id, or a signal kind (`DEPARTURE_UNCONFIRMED`) when the reader's question
   * names the matter rather than the row: the graph then answers that signal when it is one of hers.
   */
  async build(actor: Actor, recipId: string, focus: string | null = null): Promise<Xray> {
    const [story, rows, requests] = await Promise.all([
      this.stories.build(actor, recipId),
      this.exceptions.openRelatedTo(recipId),
      this.requests.openAbout(recipId),
    ]);
    const focusSignalId = focus ? (rows.find((x) => x.id === focus || x.kind === focus)?.id ?? null) : null;
    const signals: XraySignal[] = rows.map((x) => {
      const shape = SIGNAL_SHAPES[x.kind];
      const detail = x.detail as Record<string, unknown> | null;
      const rule =
        typeof detail?.['code'] === 'string'
          ? detail['code']
          : typeof detail?.['policy'] === 'string'
            ? detail['policy']
            : null;
      return {
        id: x.id,
        kind: x.kind,
        label: EXCEPTIONS[x.kind].label,
        severity: x.severity,
        source: x.source,
        title: x.title,
        entityId: x.entityId,
        rule,
        state: x.explanation.systemState.slice(0, 4),
        meaning: x.explanation.meaning,
        owner: shape.owner,
        next: shape.next,
        stakeCents: x.stake?.amountCents ?? null,
        createdAt: x.createdAt.toISOString(),
      };
    });
    return xrayFor(
      {
        today: story.today,
        asOf: this.clock.now().toISOString(),
        recip: {
          id: story.recip.id,
          number: story.recip.number,
          status: story.recip.status,
          clearances: story.recip.clearances,
          departure: story.recip.departure,
        },
        embryo: {
          id: story.embryo.id,
          status: story.embryo.status,
          cross: story.embryo.cross,
          customer: { name: story.embryo.customer.name },
        },
        pregnancy: story.pregnancy,
        money: {
          invoices: story.money.invoices.map((i) => ({
            id: i.id,
            kind: i.kind,
            status: i.status,
            amountCents: i.amountCents,
            payments: i.payments.map((p) => ({
              id: p.id,
              status: p.status,
              amountCents: p.amountCents,
            })),
          })),
          books: story.money.books.map((b) => ({
            entityId: b.entityId,
            status: b.status,
            lastError: b.lastError,
          })),
        },
        signals,
        requests: requests.map((r) => ({
          id: r.id,
          subject: r.subject,
          since: r.createdAt.toISOString().slice(0, 10),
        })),
      },
      focusSignalId,
    );
  }
}

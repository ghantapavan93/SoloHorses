import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  can,
  evaluateDeparture,
  extractEntityIds,
  formatUsd,
  lookupTerm,
  sumStakes,
  type Actor,
} from '@daysheet/domain';
import { z } from 'zod';
import { IntegrityService } from '../../accounting/application/integrity.service';
import { SettlementService } from '../../billing/application/settlement.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { BriefService } from '../../operations/application/brief.service';
import { ExceptionsService } from '../../operations/application/exceptions.service';
import { ProposalsService } from '../../operations/application/proposals.service';
import { RequestsService } from '../../operations/application/requests.service';
import { XrayService } from '../../operations/application/xray.service';
import { SIGNAL_SHAPES } from '../../operations/domain/signals';
import { PROPOSAL_KINDS } from '../../operations/domain/proposals';
import { DaysheetService } from '../../reproduction/application/daysheet.service';
import { RecordsService, type EmbryoRecord } from '../../reproduction/application/records.service';
import { TransfersService } from '../../reproduction/application/transfers.service';
import { project, type Projected } from './projection';

/**
 * The assistant's only way to know anything. Every tool is read-only, runs through the same
 * services and RBAC as the UI, and returns compact JSON whose IDs become the evidence the
 * answer must cite. Tool output is data: the system prompt says so, and the verifier
 * refuses any ID that did not come back from one of these calls.
 *
 * Each tool returns a projection (see projection.ts): the fields the model may see and
 * nothing else, stamped with the codes it contains and a hash of its state. TOOL_VERSIONS
 * changes when a tool's contract changes, so an old answer can be told from a new one.
 */

export const TOOL_VERSIONS: Record<string, string> = {
  getEmbryo: '2',
  getContract: '2',
  getHorse: '2',
  getCustomer: '2',
  getDaySheet: '2',
  searchRecords: '1',
  lookupTerm: '1',
  getOpenExceptions: '2',
  getRecipClearance: '1',
  proposeAction: '1',
  getSettlement: '1',
  getMoneyTrail: '1',
  getBrief: '1',
  getXray: '2',
};

/**
 * A small local model writes `"id(R-0037)"` or `"R-0037 (Recip #37)"` where a code belongs, and
 * `null` where it means "omit". Both are the model's slip, not the record's: the code inside is
 * taken and null reads as absent. An argument with no code in it at all still fails, as it should.
 */
const asCode = (value: unknown): unknown =>
  typeof value === 'string' ? (extractEntityIds(value)[0] ?? value.trim()) : value;
const nullAsAbsent = (value: unknown): unknown => (value === null ? undefined : value);
const code = (description: string) => z.preprocess(asCode, z.string()).describe(description);
const optionalCode = (description: string) =>
  z.preprocess((v) => nullAsAbsent(asCode(v)), z.string().optional()).describe(description);
const idArg = z.object({ id: code('An entity code such as E-26-2041, SS-26-0533, R-0347, H-0012, C-0004') });

export const TOOL_SCHEMAS = {
  getEmbryo: idArg,
  getContract: idArg,
  getHorse: idArg,
  getCustomer: idArg,
  getDaySheet: z.object({
    date: z
      .preprocess(
        nullAsAbsent,
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      )
      .describe('Barn date, YYYY-MM-DD. Omit for today.'),
  }),
  searchRecords: z.object({ query: z.string().min(2).max(80).describe('A name, code fragment, or phone number') }),
  lookupTerm: z.object({ term: z.string().min(2).max(40) }),
  getOpenExceptions: z.object({
    entityId: optionalCode('Limit to exceptions about one record code'),
    // One owner's share of the board, read whole: "what needs the vet" must not stop at the first thirty rows.
    owner: z
      .preprocess(nullAsAbsent, z.enum(['VET', 'BILLING', 'RECIPS', 'STALLION_OFFICE', 'ADMIN']).optional())
      .describe('Limit to the rows one owner acts on'),
  }),
  getRecipClearance: z.object({ id: code('A recip code such as R-0347') }),
  getSettlement: z.object({
    lotId: optionalCode('A sale lot code such as LOT-26-0041; omit for the current sale scene'),
  }),
  getMoneyTrail: z.object({ id: code('An invoice code (INV-26-…) or a payment code (PAY-26-…)') }),
  getBrief: z.object({}),
  getXray: z.object({
    recipId: code('A recip code such as R-0037'),
    // The matter the question names, so the graph answers that signal when it is one of hers.
    focus: z
      .preprocess(nullAsAbsent, z.enum(['departure', 'check', 'recipient']).optional())
      .describe(
        'What the question is about: departure (may she leave), check (the pregnancy check), recipient (an embryo held for her). Omit to let the board rank.',
      ),
  }),
  proposeAction: z.object({
    kind: z.enum(['ASSIGN_PLANNED_RECIPIENT', 'REQUEST_VETERINARY_CONFIRMATION']),
    embryoId: optionalCode('The arriving embryo, for a hold'),
    recipientId: optionalCode('The set-up recip to hold'),
    recipId: optionalCode('The recip whose departure or fee waits on a veterinary result, for a confirmation request'),
    rationale: z.string().min(3).max(300),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  tool(
    'getEmbryo',
    'Full record and timeline for one embryo: source, status, cross, storage, transfers, pregnancy checks, invoices (if the caller may see money).',
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getContract',
    'A breeding contract: stallion, mare, customer, type, status, fees, balance, semen orders.',
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getHorse',
    'A horse by code: a recip (R-…), donor mare, stallion or sale horse, with transfers carried or contracts.',
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getCustomer',
    'A customer: their horses, contracts, embryos with latest check, and invoices (if permitted).',
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getDaySheet',
    "Today's operational sheet: collection orders with SHIP/HOLD dispositions, embryos expected, checks due, lab results outstanding, site counters.",
    { date: { type: 'string', description: 'YYYY-MM-DD; omit for today' } },
    [],
  ),
  tool(
    'searchRecords',
    'Find embryos, horses, contracts and customers by name or code fragment. Use before guessing an ID.',
    { query: { type: 'string' } },
    ['query'],
  ),
  tool(
    'lookupTerm',
    "Definition of a barn or veterinary term from the operation's glossary.",
    { term: { type: 'string' } },
    ['term'],
  ),
  tool(
    'getOpenExceptions',
    'What deterministic detectors say needs a person right now: missing recips, overdue checks, held orders, failed syncs, books that disagree. Use to answer "what is wrong" or "what needs attention"; explain, never resolve. Pass owner for "what needs the vet / billing / the recip farm".',
    {
      entityId: { type: 'string', description: 'optional record code to filter by' },
      owner: {
        type: 'string',
        enum: ['VET', 'BILLING', 'RECIPS', 'STALLION_OFFICE', 'ADMIN'],
        description: 'optional: the rows one owner acts on',
      },
    },
    [],
  ),
  tool(
    'getRecipClearance',
    "The rule's own verdict on whether a recip may receive a transfer today (pre-transfer exam, uterine culture), with the clearance codes to cite. Never decide this yourself; report the verdict and, when it is not clear, say veterinary review is required.",
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getSettlement',
    "A sold lot's settlement from three sources — the ledger's payment row, the payment provider's latest event, the registration document — with the release rule's verdict. Payment metadata only: method, status, amount, provider reference; no card or account numbers exist here. If `conflict` is set, the sources disagree: abstain with SOURCES_DISAGREE and say billing review is required. Never say the papers may be released unless the verdict says so, and even then a person releases them.",
    { lotId: { type: 'string', description: 'optional lot code; omit for the current sale' } },
    [],
  ),
  tool(
    'getMoneyTrail',
    "One invoice or payment across the three systems that hold an opinion about it — the ledger, Stripe's inbox, the books — and every step in order with its source. Use for 'what happened with', 'did it sync', 'is it paid'. Metadata only; no card or account numbers exist here.",
    { id: { type: 'string' } },
    ['id'],
  ),
  tool(
    'getBrief',
    "The morning brief: the open items a person should read first (severity, then dollars held up, then age), what was raised and resolved since yesterday's snapshot, what the audit trail recorded since then by context, and the next two days as the rules see them — a mare leaving, an embryo arriving, a check crossing a billing milestone, a lab result, an invoice or settlement falling due. Use for 'what needs me this morning', 'what changed since yesterday', 'what is coming up'.",
    {},
    [],
  ),
  tool(
    'getXray',
    "One mare's evidence graph, read the way a person would: her records, the rules that read them, what each rule found missing, every open signal about her, the person the chain waits for and why, and what may be prepared next. Use for 'why can't she leave', 'why is she not ready', 'what is blocking her', 'what is her situation'. The conclusion is the leading signal's own words; cite the recip and the signal ids it returns.",
    {
      recipId: { type: 'string' },
      focus: {
        type: 'string',
        enum: ['departure', 'check', 'recipient'],
        description: 'what the question is about; omit to let the board rank',
      },
    },
    ['recipId'],
  ),
  tool(
    'proposeAction',
    'Prepare one of two acts a person must approve: ASSIGN_PLANNED_RECIPIENT holds a set-up recip for an arriving embryo (embryoId + recipientId); REQUEST_VETERINARY_CONFIRMATION asks the vet to examine and record a recip whose departure or fee waits on a veterinary result (recipId). Creates a proposal; the rule or the request runs only at approval, by a person. Never records a result, moves money, or sends anything itself.',
    {
      kind: { type: 'string', enum: ['ASSIGN_PLANNED_RECIPIENT', 'REQUEST_VETERINARY_CONFIRMATION'] },
      embryoId: { type: 'string' },
      recipientId: { type: 'string' },
      recipId: { type: 'string' },
      rationale: { type: 'string' },
    },
    ['kind', 'embryoId', 'recipientId', 'rationale'],
  ),
];

function tool(
  name: ToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): Anthropic.Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  };
}

/**
 * What an investigation returns, typed: the answer carries it beside the statements so the
 * page can render the conclusion, the rules, the boundary and the doors — not six paragraphs.
 * Derived from the x-ray tool's result, never from the model's words.
 */
export interface Investigation {
  subject: string;
  conclusion: string;
  stateHash: string;
  asOf: string;
  rulesApplied: { code: string; label: string; verdict: 'ok' | 'blocked'; reason: string | null }[];
  authority: { owner: string; reason: string; next: string; signalId: string } | null;
  availableActions: { kind: 'xray' | 'signal' | 'propose'; label: string; href?: string; question?: string }[];
  /** The block by name — which signal, of what kind, about which record — so an answer can pick the right door. */
  block: { signalId: string; kind: string; label: string; entityId: string | null } | null;
  /** The three numbers a person wants beside the answer: where the pregnancy stands, when she leaves. */
  facts: { label: string; value: string; ref: string | null }[];
  /** Requests to the team already open about her: the next step may already be in motion. */
  openRequests: { id: string; subject: string; since: string }[];
}

/** The investigation a tool result carries, when the tool was the x-ray and it succeeded. */
export function investigationOf(name: string, result: unknown): Investigation | null {
  if (name !== 'getXray' || typeof result !== 'object' || result === null || !('conclusion' in result)) return null;
  const r = result as Partial<Investigation> &
    Pick<Investigation, 'subject' | 'conclusion' | 'stateHash' | 'asOf' | 'authority' | 'availableActions'> & {
      rulesApplied: (Investigation['rulesApplied'][number] & { evidenceIds?: string[] })[];
    };
  return {
    subject: r.subject,
    conclusion: r.conclusion,
    stateHash: r.stateHash,
    asOf: r.asOf,
    rulesApplied: r.rulesApplied.map(({ code, label, verdict, reason }) => ({ code, label, verdict, reason })),
    authority: r.authority,
    availableActions: r.availableActions,
    block: r.block ?? null,
    facts: r.facts ?? [],
    openRequests: r.openRequests ?? [],
  };
}

const FOCUS_KIND: Record<string, string> = {
  departure: 'DEPARTURE_UNCONFIRMED',
  check: 'CHECK_OVERDUE',
  recipient: 'RECIPIENT_CONFLICT',
};

/**
 * Three facts from the graph's own nodes, chosen by what blocks her: for a departure, when she
 * leaves and whether the video is on record; for a check, the last one, the one due and today.
 */
function factsFor(xray: {
  nodes: {
    id: string;
    label: string;
    sublabel?: string;
    recordRef?: string;
    occurredAt?: string;
    facts: { key: string; value: string }[];
  }[];
  block: { kind: string } | null;
}): Investigation['facts'] {
  const node = (test: (n: (typeof xray.nodes)[number]) => boolean) => xray.nodes.find(test) ?? null;
  const pregnancy = node((n) => Boolean(n.recordRef?.startsWith('TR-')));
  const lastCheck = node((n) => Boolean(n.recordRef?.startsWith('CHK-')));
  const departure = node((n) => n.id === 'fact:departure');
  const video = node(
    (n) => n.id === 'gap:video' || (n.recordRef?.startsWith('CLR-') === true && n.label.startsWith('video')),
  );
  const today = pregnancy?.facts.find((f) => f.key === 'gestation day')?.value ?? null;
  const due = pregnancy?.facts.find((f) => f.key === 'next milestone')?.value ?? null;
  const last = lastCheck
    ? {
        label: 'Last check',
        value: `${lastCheck.label}${lastCheck.occurredAt ? ` · ${lastCheck.occurredAt}` : ''}`,
        ref: lastCheck.recordRef ?? null,
      }
    : { label: 'Last check', value: 'none recorded', ref: null };
  const leaves = departure
    ? {
        label: 'Leaves',
        value: `${departure.label.replace(/^leaves\s+/, '')}${departure.sublabel ? ` · ${departure.sublabel}` : ''}`,
        ref: null,
      }
    : null;
  const videoFact = video
    ? {
        label: 'Video check',
        value:
          video.id === 'gap:video'
            ? 'none on record'
            : `${video.label.replace(/^video\s*·\s*/, '')}${video.occurredAt ? ` · ${video.occurredAt}` : ''}`,
        ref: video.recordRef ?? null,
      }
    : null;
  const todayFact = today ? { label: 'Today', value: `day ${today}`, ref: null } : null;
  const dueFact = due && due !== 'none' ? { label: 'Expected', value: due, ref: null } : null;
  const kind = xray.block?.kind ?? '';
  const ordered =
    kind === 'DEPARTURE_UNCONFIRMED'
      ? [leaves, videoFact, last]
      : kind === 'CHECK_OVERDUE'
        ? [last, dueFact, todayFact]
        : [todayFact, last, leaves];
  return ordered.filter((f): f is NonNullable<typeof f> => f !== null).slice(0, 3);
}

export interface ToolCallRecord {
  name: ToolName;
  input: unknown;
  ok: boolean;
  idsReturned: string[];
  error?: string;
  durationMs: number;
  /** The projection's state hash; null for errors and for tools that return no projection. */
  contextVersion: string | null;
  toolVersion: string;
}

@Injectable()
export class AskTools {
  constructor(
    private readonly records: RecordsService,
    private readonly daysheet: DaysheetService,
    private readonly exceptions: ExceptionsService,
    private readonly transfers: TransfersService,
    private readonly proposals: ProposalsService,
    private readonly settlement: SettlementService,
    private readonly integrity: IntegrityService,
    private readonly brief: BriefService,
    private readonly clock: ClockService,
    private readonly requests: RequestsService,
    private readonly xrays: XrayService,
  ) {}

  /** Runs one tool for an actor. Never throws: errors become data the model can abstain on. */
  async execute(actor: Actor, name: string, rawInput: unknown): Promise<{ result: unknown; record: ToolCallRecord }> {
    const started = Date.now();
    const finish = (result: unknown, ok: boolean, error?: string): { result: unknown; record: ToolCallRecord } => {
      const idsReturned = ok ? extractEntityIds(JSON.stringify(result)) : [];
      const contextVersion =
        ok && typeof result === 'object' && result !== null && '_projection' in result
          ? (result as Projected<Record<string, unknown>>)._projection.contextVersion
          : null;
      return {
        result,
        record: {
          name: name as ToolName,
          input: rawInput,
          ok,
          idsReturned,
          error,
          durationMs: Date.now() - started,
          contextVersion,
          toolVersion: TOOL_VERSIONS[name] ?? '0',
        },
      };
    };

    if (!(name in TOOL_SCHEMAS)) return finish({ error: 'UNKNOWN_TOOL' }, false, 'unknown tool');
    const schema = TOOL_SCHEMAS[name as ToolName];
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success)
      return finish(
        { error: 'INVALID_INPUT', detail: parsed.error.issues.map((i) => i.message).join('; ') },
        false,
        'invalid input',
      );

    try {
      const result = await this.run(actor, name as ToolName, parsed.data);
      return finish(result, true);
    } catch (error) {
      if (error instanceof ForbiddenException)
        return finish(
          { error: 'ACCESS_DENIED', detail: 'The signed-in role may not view this record.' },
          false,
          'access denied',
        );
      if (error instanceof NotFoundException)
        return finish({ error: 'NO_RECORD', detail: error.message }, false, 'not found');
      return finish({ error: 'TOOL_FAILED', detail: (error as Error).message }, false, (error as Error).message);
    }
  }

  private async run(actor: Actor, name: ToolName, input: unknown): Promise<unknown> {
    switch (name) {
      case 'getEmbryo': {
        const { embryo, timeline } = await this.records.getEmbryo(actor, (input as { id: string }).id);
        return project('Embryo', embryo.id, summarizeEmbryo(embryo, timeline), ['intake message body', 'internal ids']);
      }
      case 'getContract': {
        const { contract, paidCents, totalCents, balanceCents } = await this.records.getContract(
          actor,
          (input as { id: string }).id,
        );
        return project(
          'Contract',
          contract.id,
          {
            id: contract.id,
            type: contract.type,
            status: contract.status,
            season: contract.season,
            customer: { id: contract.customerId, name: contract.customer.displayName },
            stallion: { id: contract.stallionId, name: contract.stallion.name },
            mare: contract.mare ? { id: contract.mare.id, name: contract.mare.name } : null,
            signedAt: contract.signedAt?.toISOString().slice(0, 10) ?? null,
            fees: {
              depositCents: contract.depositCents,
              studFeeCents: contract.studFeeCents,
              chuteFeeCents: contract.chuteFeeCents,
              totalCents,
              paidCents,
              balanceCents,
              balance: formatUsd(balanceCents),
            },
            semenOrders: contract.semenOrders.slice(0, 10).map((o) => ({
              id: o.id,
              status: o.status,
              requestedFor: o.requestedFor.toISOString().slice(0, 10),
              shipTo: `${o.shipToVet}, ${o.shipToCity}`,
            })),
            invoices: contract.invoices.map((i) => ({
              id: i.id,
              kind: i.kind,
              status: i.status,
              amountCents: i.amountCents,
              dueOn: i.dueOn.toISOString().slice(0, 10),
            })),
            embryos: contract.embryos.map((e) => ({ id: e.id, status: e.status })),
          },
          ['Stripe ids', 'payment method details'],
        );
      }
      case 'getHorse': {
        // A cached summary: dates are ISO strings whether this read hit or missed.
        const horse = await this.records.getHorse(actor, (input as { id: string }).id);
        return project(
          'Horse',
          horse.id,
          {
            id: horse.id,
            name: horse.name,
            sex: horse.sex,
            kind: horse.kind,
            site: horse.site,
            recipNumber: horse.recipNumber,
            recipStatus: horse.recipStatus,
            birthYear: horse.birthYear,
            owner: horse.owner ? { id: horse.owner.id, name: horse.owner.displayName } : null,
            transfers: horse.transfers.slice(0, 10).map((t) => ({
              id: t.id,
              embryoId: t.embryoId,
              embryoStatus: t.embryo.status,
              performedOn: t.performedOn.slice(0, 10),
              latestCheck: t.checks[0]
                ? {
                    id: t.checks[0].id,
                    day: t.checks[0].dayNumber,
                    result: t.checks[0].result,
                    on: t.checks[0].performedOn.slice(0, 10),
                  }
                : null,
            })),
            contracts: horse.contractsAsStallion
              .slice(0, 10)
              .map((c) => ({ id: c.id, status: c.status, customer: c.customer.displayName })),
            clearances: horse.clearances
              .slice(0, 8)
              .map((c) => ({ id: c.id, kind: c.kind, result: c.result, performedOn: c.performedOn.slice(0, 10) })),
          },
          ['registration number', 'free-text notes'],
        );
      }
      case 'getCustomer': {
        const c = await this.records.getCustomer(actor, (input as { id: string }).id);
        return project(
          'Customer',
          c.id,
          {
            id: c.id,
            name: c.displayName,
            horses: c.horses.map((h) => ({ id: h.id, name: h.name, kind: h.kind })),
            contracts: c.contracts.map((k) => ({
              id: k.id,
              status: k.status,
              stallion: k.stallion.name,
              type: k.type,
            })),
            embryos: c.embryos.map((e) => {
              const t = e.transfers[0];
              const chk = t?.checks[0];
              return {
                id: e.id,
                status: e.status,
                recip: t ? { id: t.recipientId, number: t.recipient.recipNumber } : null,
                transferId: t?.id ?? null,
                latestCheck: chk
                  ? {
                      id: chk.id,
                      day: chk.dayNumber,
                      result: chk.result,
                      on: chk.performedOn.toISOString().slice(0, 10),
                    }
                  : null,
              };
            }),
            invoices: c.invoices.map((i) => ({
              id: i.id,
              kind: i.kind,
              status: i.status,
              amountCents: i.amountCents,
              paidCents: i.payments.filter((p) => p.status === 'SUCCEEDED').reduce((sum, p) => sum + p.amountCents, 0),
            })),
          },
          ['e-mail', 'phone', 'Stripe customer id', 'notes'],
        );
      }
      case 'getDaySheet': {
        const sheet = await this.daysheet.build(actor, (input as { date?: string }).date);
        return project('DaySheet', sheet.today, {
          today: sheet.today,
          isCollectionDay: sheet.isCollectionDay,
          isAspirationDay: sheet.isAspirationDay,
          counters: sheet.counters,
          collection: sheet.collection.map((r) => ({
            orderId: r.orderId,
            contractId: r.contractId,
            customer: r.customer,
            mare: r.mare,
            mareId: r.mareId,
            stallion: r.stallion,
            shipTo: r.shipTo,
            disposition: r.disposition,
            holds: r.holds,
          })),
          embryosExpectedOrUnassigned: sheet.transfers.map((t) => ({
            embryoId: t.embryoId,
            customer: t.customer,
            cross: t.cross,
            status: t.status,
            expectedOn: t.expectedOn,
          })),
          checksDue: sheet.checksDue.map((c) => ({
            transferId: c.transferId,
            embryoId: c.embryoId,
            recipId: c.recipId,
            customer: c.customer,
            gestationDay: c.gestationDay,
            lastCheck: c.lastCheck,
            crossesToday: c.crossesToday,
          })),
          labResultsOutstanding: sheet.labDue.map((l) => ({
            labBatchId: l.labBatchId,
            donor: l.donor,
            donorId: l.donorId,
            shippedOn: l.shippedOn,
            expectedResultOn: l.expectedResultOn,
            daysOut: l.daysOut,
          })),
        });
      }
      case 'searchRecords': {
        const results = await this.records.search(actor, (input as { query: string }).query);
        return project('Search', (input as { query: string }).query, { results });
      }
      case 'getRecipClearance': {
        const verdict = await this.transfers.clearanceFor((input as { id: string }).id);
        const horse = await this.records.getHorse(actor, verdict.recipId);
        return project('Clearance', verdict.recipId, {
          recipId: verdict.recipId,
          recipStatus: horse.recipStatus,
          verdict: verdict.ok ? 'CLEARED' : 'NOT_CLEARED',
          code: verdict.ok ? null : verdict.code,
          reason: verdict.ok ? 'Current pre-transfer exam and uterine culture on record.' : verdict.reason,
          evidenceIds: verdict.evidenceIds,
          clearances: horse.clearances.map((c) => ({
            id: c.id,
            kind: c.kind,
            result: c.result,
            performedOn: c.performedOn.slice(0, 10),
            expiresOn: c.expiresOn?.slice(0, 10) ?? null,
          })),
        });
      }
      case 'proposeAction': {
        const args = input as {
          kind: 'ASSIGN_PLANNED_RECIPIENT' | 'REQUEST_VETERINARY_CONFIRMATION';
          embryoId?: string;
          recipientId?: string;
          recipId?: string;
          rationale: string;
        };
        // The assistant prepares on behalf of a person who could approve: a client has a record, not a say in the farm's next step.
        if (!can(actor, 'write', 'operations') && !can(actor, 'write', 'embryo'))
          throw new ForbiddenException(`${actor.role} may not prepare an action for the team`);
        if (args.kind === 'REQUEST_VETERINARY_CONFIRMATION') {
          if (!args.recipId) throw new BadRequestException('recipId is required to request veterinary confirmation');
          // The request is written from her records — the departure date and what the lease's rule found — never from the question.
          const horse = await this.records.getHorse(actor, args.recipId);
          if (horse.kind !== 'RECIPIENT') throw new BadRequestException(`${args.recipId} is not a recip`);
          const departureOn = horse.scheduledDepartureOn ? horse.scheduledDepartureOn.slice(0, 10) : null;
          const verdict = evaluateDeparture(
            {
              id: horse.id,
              scheduledDepartureOn: departureOn,
              clearances: horse.clearances.map((c) => ({
                id: c.id,
                kind: c.kind,
                result: c.result,
                performedOn: c.performedOn.slice(0, 10),
                expiresOn: c.expiresOn?.slice(0, 10) ?? null,
              })),
            },
            this.clock.today(),
          );
          const subject = `Veterinary confirmation for ${horse.id} (Recip #${horse.recipNumber ?? '?'})`;
          // One open request per subject: a second would be noise for the vet, so nothing is prepared.
          const pending = (await this.requests.openAbout(horse.id)).find((r) => r.subject === subject);
          if (pending)
            return {
              error: 'ALREADY_PENDING',
              detail: `a veterinary request for ${horse.id} is already open since ${pending.createdAt.toISOString().slice(0, 10)}; nothing new was prepared`,
              requestId: pending.id,
              recipId: horse.id,
              subject,
            };
          const body = departureOn
            ? `${horse.id} leaves with her client on ${departureOn}. The lease requires a video-confirmed in-foal check within 3 days of departure; ${verdict.ok ? 'one is on record — please confirm it still stands' : 'none is on record'}. Please examine her and record the result. Prepared by the assistant from the records; sent by the person who approved it.`
            : `${horse.id} waits on a veterinary result before the next step. Please examine her and record it. Prepared by the assistant from the records; sent by the person who approved it.`;
          const row = await this.proposals.propose(
            actor,
            args.kind,
            { recipId: horse.id, subject, body },
            args.rationale,
            [horse.id],
          );
          return project('Proposal', row.id, {
            proposalId: row.id,
            kind: row.kind,
            status: row.status,
            recipId: horse.id,
            subject,
            body,
            departure: departureOn ? { on: departureOn, rule: verdict.ok ? 'satisfied' : verdict.code } : null,
            willNot: PROPOSAL_KINDS[row.kind].willNot,
            note: 'Nothing has changed. A person with operations rights approves, edits or declines; approval sends the request with their name on it, and refuses if her records moved in between.',
          });
        }
        if (!args.embryoId || !args.recipientId)
          throw new BadRequestException('embryoId and recipientId are required to hold a recip');
        // A preview of the rule so the proposal carries its own verdict; approval re-runs it.
        const preview = await this.transfers.plannedRecipientFor(args.embryoId, args.recipientId);
        const row = await this.proposals.propose(
          actor,
          args.kind,
          { embryoId: args.embryoId, recipientId: args.recipientId },
          args.rationale,
          [args.embryoId, args.recipientId],
        );
        return project('Proposal', row.id, {
          proposalId: row.id,
          kind: row.kind,
          status: row.status,
          embryoId: args.embryoId,
          recipientId: args.recipientId,
          rulePreview: preview,
          willNot: PROPOSAL_KINDS[row.kind].willNot,
          note: 'Nothing has changed. A person with the recip farm or stallion office role approves or declines; approval runs the rule again.',
        });
      }
      case 'getOpenExceptions': {
        const { entityId, owner } = input as { entityId?: string; owner?: string };
        const rows = entityId
          ? await this.exceptions.openRelatedTo(entityId)
          : await this.exceptions.list(['OPEN', 'ACKNOWLEDGED'], owner ? 500 : 100);
        const visible = this.exceptions
          .visibleTo(actor, rows)
          .filter((x) => !owner || SIGNAL_SHAPES[x.kind].owner === owner);
        return project('Operations', entityId ?? 'board', {
          open: visible.length,
          atStake: formatUsd(sumStakes(visible.flatMap((x) => (x.stake ? [x.stake] : [])))),
          exceptions: visible.slice(0, 30).map((x) => ({
            id: x.id,
            kind: x.kind,
            severity: x.severity,
            source: x.source,
            status: x.status,
            title: x.title,
            entityType: x.entityType,
            entityId: x.entityId,
            since: x.createdAt.toISOString(),
            owner: x.owner?.name ?? null,
            atStake: x.stake ? { amount: formatUsd(x.stake.amountCents), waitingOn: x.stake.label } : null,
          })),
        });
      }
      case 'getXray': {
        const { recipId, focus } = input as { recipId: string; focus?: 'departure' | 'check' | 'recipient' };
        // The same graph the story page draws, as data; the actions are the doors the reader may open.
        const [xray, storyRecipId, openRequests] = await Promise.all([
          this.xrays.build(actor, recipId, focus ? (FOCUS_KIND[focus] ?? null) : null),
          this.xrays.storyRecipId(),
          this.requests.openAbout(recipId),
        ]);
        const mayPropose = can(actor, 'write', 'operations') || can(actor, 'write', 'embryo');
        const boundary = xray.unresolvedBoundary;
        const availableActions: Investigation['availableActions'] = [
          {
            kind: 'xray',
            label: 'See the X-ray',
            href: xray.subject === storyRecipId ? '/story#why' : `/horses/${xray.subject}`,
          },
          ...(boundary
            ? [{ kind: 'signal' as const, label: `Open ${boundary.signalId}`, href: `/signals/${boundary.signalId}` }]
            : []),
          ...(boundary && boundary.owner === 'VET' && mayPropose
            ? [
                {
                  kind: 'propose' as const,
                  label: 'Prepare the vet request',
                  question: `Prepare the vet request for ${xray.subject}`,
                },
              ]
            : []),
        ];
        const investigation: Investigation = {
          subject: xray.subject,
          conclusion: xray.conclusion,
          stateHash: xray.stateHash,
          asOf: xray.asOf,
          rulesApplied: xray.rulesApplied.map((r) => ({
            code: r.code,
            label: r.label,
            verdict: r.verdict,
            reason: r.reason,
          })),
          authority: boundary
            ? { owner: boundary.owner, reason: boundary.reason, next: boundary.next, signalId: boundary.signalId }
            : null,
          availableActions,
          block: xray.block,
          facts: factsFor(xray),
          openRequests: openRequests.map((r) => ({
            id: r.id,
            subject: r.subject,
            since: r.createdAt.toISOString().slice(0, 10),
          })),
        };
        return project('Xray', xray.subject, {
          ...investigation,
          rulesApplied: xray.rulesApplied.map((r) => ({
            code: r.code,
            label: r.label,
            verdict: r.verdict,
            reason: r.reason,
            evidenceIds: r.evidenceIds,
          })),
          signals: xray.nodes
            .filter((n) => n.type === 'signal' && n.recordRef)
            .map((n) => ({ id: n.recordRef, label: n.label, status: n.status })),
          records: xray.nodes
            .filter((n) => n.recordRef && n.type !== 'signal')
            .map((n) => ({ id: n.recordRef, label: n.label, status: n.status, source: n.source })),
        });
      }
      case 'getBrief': {
        // The brief is the operation's own: a client has a record, not a board.
        if (!can(actor, 'read', 'operations'))
          throw new ForbiddenException('the brief is the operation’s, not a client’s');
        const brief = await this.brief.build(actor);
        const money = (cents: number | null | undefined) => (typeof cents === 'number' ? formatUsd(cents) : null);
        return project('Brief', brief.barnDate, {
          asOf: brief.asOf,
          since: brief.since,
          baseline: brief.baseline
            ? {
                takenAt: brief.baseline.takenAt,
                open: brief.baseline.open,
                atStake: formatUsd(brief.baseline.atStakeCents),
              }
            : null,
          open: brief.open,
          atStake: formatUsd(brief.atStakeCents),
          withStake: brief.withStake,
          needsYou: brief.needsYou.map((r) => ({
            id: r.id,
            kind: r.kind,
            severity: r.severity,
            title: r.title,
            entityId: r.entityId,
            atStake: money(r.stakeCents),
            waitingOn: r.stakeLabel,
            owner: r.owner,
            next: r.next,
          })),
          sinceYesterday: {
            raised: brief.sinceYesterday.raised.map((r) => ({
              id: r.id,
              kind: r.kind,
              severity: r.severity,
              title: r.title,
              entityId: r.entityId,
              at: r.createdAt,
            })),
            resolved: brief.sinceYesterday.resolved.map((x) => ({
              id: x.id,
              kind: x.kind,
              title: x.title,
              status: x.status,
              at: x.resolvedAt,
              resolution: x.resolution,
              by: x.resolvedBy,
            })),
            changes: brief.sinceYesterday.changes.map((g) => ({
              context: g.context,
              count: g.count,
              actions: g.actions.map((a) => `${a.label} ×${a.count}`),
            })),
          },
          next48Hours: brief.lookahead.map((i) => ({
            on: i.on,
            kind: i.kind,
            label: i.label,
            entityId: i.entityId,
            state: i.state,
            note: i.note,
            amount: money(i.amountCents),
          })),
        });
      }
      case 'getSettlement': {
        const lotId = (input as { lotId?: string }).lotId ?? (await this.settlement.lotIdForScene());
        const scene = await this.settlement.scene(actor, lotId);
        // Money metadata a person may see: method, status, amount, reference. Nothing that identifies a card or an account exists to project.
        return project(
          'SaleLot',
          scene.lot.id,
          {
            lot: {
              id: scene.lot.id,
              kind: scene.lot.kind,
              closedOn: scene.lot.closedOn,
              hammerCents: scene.lot.hammerCents,
              hammer: formatUsd(scene.lot.hammerCents),
              buyer: scene.lot.buyer,
            },
            invoice: scene.invoice
              ? {
                  id: scene.invoice.id,
                  status: scene.invoice.status,
                  amountCents: scene.invoice.amountCents,
                  settlementDue: `${scene.invoice.dueOn} ${scene.invoice.dueTime}`,
                }
              : null,
            payment: scene.payment
              ? {
                  id: scene.payment.id,
                  method: scene.payment.method,
                  status: scene.payment.status,
                  amountCents: scene.payment.amountCents,
                  providerReference: scene.payment.stripePaymentIntentId,
                  cardOrAccountNumber: 'not stored by this application (FIN-DATA-03)',
                }
              : null,
            document: scene.document
              ? {
                  id: scene.document.id,
                  kind: scene.document.kind,
                  status: scene.document.status,
                  releasedBy: scene.document.releasedBy?.name ?? null,
                }
              : null,
            funds: scene.funds,
            releaseRule: {
              policy: scene.rule.policy,
              verdict: scene.rule.ok ? 'ELIGIBLE' : 'HELD',
              code: scene.rule.ok ? null : scene.rule.code,
              reason: scene.rule.ok
                ? 'Funds have cleared; a person with billing rights releases the papers.'
                : scene.rule.reason,
              evidenceIds: scene.rule.evidenceIds,
            },
            sources: scene.sources,
            conflict: scene.conflict
              ? {
                  code: scene.conflict.ok ? null : scene.conflict.code,
                  reason: scene.conflict.ok ? null : scene.conflict.reason,
                }
              : null,
            returns: scene.returns.map((r) => ({
              lotId: r.lot.id,
              recipId: r.recip.id,
              recipNumber: r.recip.number,
              weanedOn: r.recip.weanedOn,
              returnedOn: r.recip.returnedOn,
              assessment: r.assessment
                ? { id: r.assessment.id, result: r.assessment.result, performedOn: r.assessment.performedOn }
                : null,
              verdict: r.rule.ok ? 'CONDITION_MET' : r.rule.code,
              reason: r.rule.ok
                ? 'Returned open and in good health on the vet’s record; no recipient purchase fee.'
                : r.rule.reason,
              decision: r.decision,
            })),
          },
          ['card and account numbers (never stored)', 'buyer contact details'],
        );
      }
      case 'getMoneyTrail': {
        const id = (input as { id: string }).id;
        const invoiceId = id.startsWith('PAY-') ? await this.integrity.invoiceIdForPayment(id) : id;
        if (!invoiceId) throw new NotFoundException(`${id} not found`);
        const { row, timeline } = await this.integrity.timeline(actor, invoiceId);
        return project(
          'Invoice',
          row.id,
          {
            invoice: {
              id: row.id,
              kind: row.kind,
              status: row.status,
              amountCents: row.amountCents,
              amount: formatUsd(row.amountCents),
              issuedOn: row.issuedOn,
              customer: row.customer,
              embryoId: row.embryoId,
            },
            ledger: row.daysheet,
            stripe: {
              status: row.stripe.status,
              ok: row.stripe.ok,
              eventId: row.stripe.eventId,
              deliveries: row.stripe.deliveries,
              duplicatesRejected: row.stripe.duplicates,
            },
            books: {
              status: row.books.status,
              ok: row.books.ok,
              invoice: row.books.invoice,
              payment: row.books.payment,
              note: row.books.note,
            },
            openDiscrepancies: row.openDiscrepancies,
            steps: timeline
              .slice(-14)
              .map((t) => ({ at: t.at, source: t.source, title: t.title, detail: t.detail, ok: t.ok, ids: t.ids })),
          },
          ['card and account numbers (never stored)'],
        );
      }
      case 'lookupTerm': {
        const entry = lookupTerm((input as { term: string }).term);
        return entry
          ? { term: entry.term, definition: entry.definition, source: entry.source, boundary: entry.boundary ?? null }
          : { error: 'NO_RECORD', detail: 'not in the glossary' };
      }
    }
  }
}

function summarizeEmbryo(
  e: EmbryoRecord,
  timeline: { id: string; at: string; kind: string; title: string; detail?: string; amountCents?: number }[],
) {
  return {
    id: e.id,
    source: e.source,
    status: e.status,
    customer: { id: e.customerId, name: e.customer.displayName },
    contract: e.contract
      ? { id: e.contract.id, type: e.contract.type, status: e.contract.status, stallion: e.contract.stallion.name }
      : null,
    cross: {
      sire: e.sire ? { id: e.sire.id, name: e.sire.name } : e.sireName ? { name: e.sireName } : null,
      dam: e.dam ? { id: e.dam.id, name: e.dam.name } : e.damName ? { name: e.damName } : null,
    },
    storage: e.storageTank ? { tank: e.storageTank, slot: e.storageSlot } : null,
    expectedOn: e.expectedOn?.toISOString() ?? null,
    arrivedAt: e.arrivedAt?.toISOString() ?? null,
    sendingVet: e.sendingVet,
    aspiration: e.aspiration
      ? {
          id: e.aspiration.id,
          donor: e.aspiration.donorMare.name,
          donorId: e.aspiration.donorMareId,
          performedOn: e.aspiration.performedOn.toISOString().slice(0, 10),
          lab: e.aspiration.labBatch
            ? {
                id: e.aspiration.labBatch.id,
                status: e.aspiration.labBatch.status,
                embryoCount: e.aspiration.labBatch.embryoCount,
                expectedResultOn: e.aspiration.labBatch.expectedResultOn.toISOString().slice(0, 10),
              }
            : null,
        }
      : null,
    transfers: e.transfers.map((t) => ({
      id: t.id,
      recip: { id: t.recipientId, number: t.recipient.recipNumber, status: t.recipient.recipStatus },
      performedOn: t.performedOn.toISOString().slice(0, 10),
      checks: t.checks.map((c) => ({
        id: c.id,
        day: c.dayNumber,
        result: c.result,
        on: c.performedOn.toISOString().slice(0, 10),
        by: c.recordedBy.name,
        notes: c.notes,
      })),
    })),
    invoices: e.invoices.map((i) => ({
      id: i.id,
      kind: i.kind,
      status: i.status,
      amountCents: i.amountCents,
      triggeredByCheckId: i.triggeredByCheckId,
    })),
    timeline: timeline.slice(0, 20).map((t) => ({ id: t.id, at: t.at.slice(0, 10), kind: t.kind, title: t.title })),
  };
}

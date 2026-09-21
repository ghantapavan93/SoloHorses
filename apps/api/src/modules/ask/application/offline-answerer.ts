import { expectedFoalingOn, FEES, formatUsd, HEARTBEAT_DAY, type Actor, type AskAnswer } from '@daysheet/domain';
import { EXCEPTIONS } from '../../operations/domain/exceptions';
import { PROPOSAL_KINDS } from '../../operations/domain/proposals';
import { AskTools, investigationOf, type Investigation, type ToolCallRecord } from './ask.tools';
import type { CardHints } from './card';

/**
 * When no model key is configured, the demo still has to behave: the same tools run, the
 * same projections come back, and a small deterministic composer turns them into the same
 * structured answer shape — statements with evidence, abstentions with reasons, proposals a
 * person must approve. It handles the handful of question shapes the front door suggests
 * and abstains honestly on everything else. Labeled `offline-deterministic` on every answer
 * so nobody mistakes it for the model.
 */
/** What the answerer knows before the question: the mare of the story, and the record the person is looking at or was just talking about. */
export interface OfflineContext {
  storyRecipId: string | null;
  /** The page's record, else the conversation's last subject; "she", "it", "this" mean this one. */
  subjectId: string | null;
}

export interface OfflineOutcome {
  answer: AskAnswer;
  toolCalls: ToolCallRecord[];
  proposalIds: string[];
  handled: boolean;
  /** The typed result of an x-ray read, when the question was about one mare's situation. */
  investigation?: Investigation | null;
  /** What the card cannot read back from the records: the sentence, the facts, the rows, the view. */
  hints?: CardHints | null;
}

interface OfflineBrief {
  open: number;
  atStake: string;
  baseline: { takenAt: string } | null;
  needsYou: {
    id: string;
    title: string;
    entityId: string | null;
    atStake: string | null;
    waitingOn: string | null;
    next: string;
  }[];
  sinceYesterday: {
    raised: { id: string; title: string; entityId: string | null }[];
    resolved: { id: string; title: string; resolution: string | null; by: string | null }[];
    changes: { context: string; count: number }[];
  };
  next48Hours: {
    on: string;
    label: string;
    entityId: string | null;
    state: string;
    note: string;
    amount: string | null;
  }[];
}

const CODE = /\b(E|R|H|SS|INV|PAY|TR|CHK|C|OX|LOT|DOC|RQ)-(?:\d{2}-)?\d{4,6}\b/g;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export class OfflineAnswerer {
  constructor(private readonly tools: AskTools) {}

  async answer(actor: Actor, question: string, context: OfflineContext): Promise<OfflineOutcome> {
    const q = question.trim();
    const codes = Array.from(new Set(q.match(CODE) ?? []));
    const toolCalls: ToolCallRecord[] = [];
    const call = async (name: string, input: unknown) => {
      const { result, record } = await this.tools.execute(actor, name, input);
      toolCalls.push(record);
      return { result: result as Record<string, unknown>, record };
    };
    // "Recip #36" is a name on the neck tag; the record is R-0036.
    const recipNumber = /\brecip\s*#?\s*(\d{1,4})\b/i.exec(q)?.[1];
    if (recipNumber && !codes.some((c) => c.startsWith('R-'))) codes.push(`R-${recipNumber.padStart(4, '0')}`);
    // A pronoun means the record in front of the person, then the one the conversation is about, then the story's mare.
    const subjectRecip = context.subjectId?.startsWith('R-') ? context.subjectId : null;
    const deictic = /\b(she|her|hers|it|its|this|that|this one|the mare|this mare|recip|the request)\b/i.test(q);
    const recipInQuestion =
      codes.find((c) => c.startsWith('R-')) ?? (deictic ? (subjectRecip ?? context.storyRecipId) : null);

    // "Is she cleared for transfer?" — the rule answers; the vet decides.
    if (
      /\b(clear(ed)?|clearance|ready|ok(ay)?)\b.*\b(transfer|implant)\b|\btransfer\b.*\b(clear(ed)?|ready)\b/i.test(
        q,
      ) &&
      recipInQuestion
    ) {
      const { result, record } = await call('getRecipClearance', { id: recipInQuestion });
      if (!record.ok) return this.abstainOn(q, 'NO_RECORD', `No recip record for ${recipInQuestion}.`, toolCalls);
      const verdict = result['verdict'] as string;
      const reason = text(result['reason']);
      const evidence = (result['evidenceIds'] as string[]) ?? [recipInQuestion];
      if (verdict === 'CLEARED') {
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [
              { text: `${recipInQuestion} is cleared for a transfer today: ${reason}`, evidence, confidence: 'HIGH' },
            ],
            abstentions: [],
            conflicts: [],
            summary: `${recipInQuestion} is cleared for a transfer on the records the rule reads. Whether to do it today is the vet's call.`,
          },
        };
      }
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [
            { text: `The transfer rule does not clear ${recipInQuestion}: ${reason}`, evidence, confidence: 'HIGH' },
          ],
          abstentions: [
            {
              question: q.slice(0, 300),
              reason: 'FIELD_EMPTY',
              detail: `I cannot establish clearance from the available record (${String(result['code'])}). Veterinary review is required.`,
            },
          ],
          conflicts: [],
          summary: `Not cleared on the records: ${reason} Veterinary review is required; nothing here decides a transfer.`,
          suggestedRequest: {
            subject: `Clearance for ${recipInQuestion}`,
            body: `Asked whether ${recipInQuestion} is cleared for a transfer. The rule says: ${reason}`,
            evidenceIds: evidence.slice(0, 12),
          },
        },
      };
    }

    // "Can we decide the $6,000 recipient fee now?" — the return rule says whether a person can decide yet.
    if (
      /\b(recip(ient)?\s+(purchase\s+)?fee|return\s+fee|6,?000|fee\b.*\b(recip|return|mare)|(recip|return|mare)\b.*\bfee)\b/i.test(
        q,
      )
    ) {
      const { result, record } = await call('getSettlement', {});
      if (!record.ok) return this.abstainOn(q, 'NO_RECORD', 'No sale is on record.', toolCalls);
      const returns =
        (result['returns'] as {
          lotId: string;
          recipId: string;
          recipNumber: number | null;
          returnedOn: string | null;
          assessment: { id: string; result: string; performedOn: string } | null;
          verdict: string;
          reason: string;
          decision: string;
        }[]) ?? [];
      const r = returns.find((x) => codes.includes(x.recipId) || codes.includes(x.lotId)) ?? returns[0];
      if (!r)
        return this.abstainOn(
          q,
          'NO_RECORD',
          'No recipient sold in utero has come back; there is no fee to decide.',
          toolCalls,
        );
      const evidence = Array.from(new Set([r.recipId, r.lotId, ...(r.assessment ? [r.assessment.id] : [])]));
      if (r.decision === 'WAITING_ON_VET') {
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [
              {
                text: `Not yet. ${r.recipId} (Recip #${r.recipNumber ?? '?'}, ${r.lotId}) came back${r.returnedOn ? ` on ${r.returnedOn}` : ''} and ${r.assessment ? `the return assessment is ${r.assessment.result.toLowerCase()}` : 'no veterinary return assessment is on record'}; whether she is open and in good health cannot be established from the record.`,
                evidence,
                confidence: 'HIGH',
              },
            ],
            abstentions: [
              {
                question: q.slice(0, 300),
                reason: 'VETERINARY_JUDGMENT',
                detail:
                  'The sale condition turns on the vet’s assessment. Route to the veterinary team; a person decides the fee after it is on record.',
              },
            ],
            conflicts: [],
            summary:
              'Not yet: the vet’s return assessment is missing, so nobody can say whether the condition was met. Route to veterinary; the fee is a person’s decision after that, never the system’s.',
            suggestedRequest: {
              subject: `Return assessment for ${r.recipId}`,
              body: `Asked whether the recipient purchase fee can be decided for ${r.lotId}. The return assessment on ${r.recipId} is not on record.`,
              evidenceIds: evidence,
            },
          },
        };
      }
      if (r.decision === 'A_PERSON_DECIDES') {
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [
              {
                text: `The record now allows a decision, and it is a person’s: ${r.reason}`,
                evidence,
                confidence: 'HIGH',
              },
            ],
            abstentions: [
              {
                question: q.slice(0, 300),
                reason: 'FINANCIAL_ACTION',
                detail:
                  'The $6,000 recipient purchase fee is billing’s decision, made on the board with a note; nothing here charges it.',
              },
            ],
            conflicts: [],
            summary:
              'The vet’s record does not meet the sale condition, so the fee may apply — and a person with billing rights decides that, on the board, with a note. Ask cannot charge it.',
            suggestedRequest: {
              subject: `Recipient purchase fee on ${r.lotId}`,
              body: `The return assessment on ${r.recipId} did not find her open and in good health. The sale condition names a $6,000 recipient purchase fee; billing decides.`,
              evidenceIds: evidence,
            },
          },
        };
      }
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [{ text: `No fee: ${r.recipId} (${r.lotId}) ${r.reason}`, evidence, confidence: 'HIGH' }],
          abstentions: [],
          conflicts: [],
          summary: `The condition was met on the vet’s record; no recipient purchase fee applies to ${r.lotId}.`,
        },
      };
    }

    // "Why are the papers held?" / "Can the papers for LOT-26-0041 be released?" / "Has the ACH cleared?"
    const lotInQuestion = codes.find((c) => c.startsWith('LOT-')) ?? null;
    if (
      lotInQuestion ||
      /\b(papers?|registration|certificate|settlement|settle|ach|hammer|lot|who\s+bought|cleared\s+funds|funds\s+clear)\b/i.test(
        q,
      )
    ) {
      const { result, record } = await call('getSettlement', lotInQuestion ? { lotId: lotInQuestion } : {});
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(
            result['detail'],
            lotInQuestion ? `No sale lot record for ${lotInQuestion}.` : 'No sale settlement is on record.',
          ),
          toolCalls,
        );
      const lot = result['lot'] as { id: string; hammer: string; buyer: { id: string; name: string } };
      const invoice = result['invoice'] as { id: string; status: string; settlementDue: string } | null;
      const payment = result['payment'] as {
        id: string;
        method: string;
        status: string;
        providerReference: string | null;
      } | null;
      const document = result['document'] as { id: string; status: string; releasedBy: string | null } | null;
      const rule = result['releaseRule'] as {
        policy: string;
        verdict: string;
        code: string | null;
        reason: string;
        evidenceIds: string[];
      };
      const conflict = result['conflict'] as { code: string | null; reason: string | null } | null;
      const evidence = Array.from(
        new Set([lot.id, invoice?.id, payment?.id, document?.id].filter((x): x is string => Boolean(x))),
      );
      if (conflict?.code) {
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [
              {
                text: `${lot.id}: the ledger and the payment provider do not agree about ${payment?.id ?? 'the payment'} — ${conflict.reason ?? 'the sources disagree'}.`,
                evidence,
                confidence: 'HIGH',
              },
            ],
            abstentions: [
              {
                question: q.slice(0, 300),
                reason: 'SOURCES_DISAGREE',
                detail:
                  'I cannot establish final settlement status because the available sources disagree. Billing review is required.',
              },
            ],
            conflicts:
              payment && invoice
                ? [
                    {
                      ids: [payment.id, invoice.id],
                      description: `Ledger says ${payment.status.toLowerCase()}; the provider's latest event says otherwise. No winner is picked here.`,
                    },
                  ]
                : [],
            summary:
              'I cannot establish final settlement status because the available sources disagree. Billing review is required; the papers stay where they are until a person decides.',
            suggestedRequest: {
              subject: `Settlement sources disagree on ${lot.id}`,
              body: `Asked about ${lot.id}. The ledger and the payment provider disagree about ${payment?.id ?? 'the payment'}: ${conflict.reason ?? ''}`,
              evidenceIds: evidence.slice(0, 12),
            },
          },
        };
      }
      const paymentLine = payment
        ? `${lot.id} (${lot.hammer}, bought by ${lot.buyer.name}) was paid by ${payment.method.toLowerCase()}; the ledger says ${payment.status.toLowerCase()}${invoice ? `, settlement due ${invoice.settlementDue}` : ''}.`
        : `${lot.id} (${lot.hammer}) has no payment on record${invoice ? `; settlement is due ${invoice.settlementDue}` : ''}.`;
      const paperLine = document
        ? document.status === 'RELEASED'
          ? `The registration papers (${document.id}) were released by ${document.releasedBy ?? 'a person with billing rights'}.`
          : rule.verdict === 'ELIGIBLE'
            ? `The registration papers (${document.id}) are eligible for release under ${rule.policy}: funds have cleared. A person with billing rights sends them; nothing here does.`
            : `The registration papers (${document.id}) are held under ${rule.policy}: ${rule.reason}`
        : 'No registration document is on record for this lot.';
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [
            { text: paymentLine, evidence, confidence: 'HIGH' },
            { text: paperLine, evidence, confidence: 'HIGH' },
          ],
          abstentions: [],
          conflicts: [],
          summary: `${paymentLine} ${paperLine}`,
        },
      };
    }

    // "Who needs to handle it?" / "Who decides?" — the person the chain waits for, from the x-ray; nothing else decides it.
    if (
      recipInQuestion &&
      /\b(who)\b.*\b(handle|handles|owns?|decides?|acts?|does|takes|responsible|next step|call)\b|\bwhose\b/i.test(q)
    ) {
      const { result, record } = await call('getXray', { recipId: recipInQuestion, focus: focusFor(q) });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No x-ray for ${recipInQuestion}.`),
          toolCalls,
        );
      const investigation = investigationOf('getXray', result);
      const authority = investigation?.authority ?? null;
      const cite = (...ids: (string | null | undefined)[]) =>
        Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
      const line = authority
        ? `${ownerWord(authority.owner)} owns the next step for ${recipInQuestion}: ${authority.next.toLowerCase()}. ${authority.reason.replace(/^a /, 'It is a ')}.`
        : `Nobody: nothing about ${recipInQuestion} waits on a person.`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        investigation,
        answer: {
          statements: [{ text: line, evidence: cite(recipInQuestion, authority?.signalId), confidence: 'HIGH' }],
          abstentions: [],
          conflicts: [],
          summary: authority
            ? `${ownerWord(authority.owner)} decides; no decision is required from anyone else, and the assistant can prepare the request, not take the step.`
            : line,
        },
      };
    }

    // "What happens after they approve it?" — the catalog's own words for the act: what runs, what it will never do, what stays open.
    if (
      recipInQuestion &&
      /\b(what happens|then what|and then|after (they|i|we|it is|it's|approval)|once (it is|it's|they|i) approve|if (i|we|they) approve)\b/i.test(
        q,
      )
    ) {
      const { result, record } = await call('getXray', { recipId: recipInQuestion, focus: focusFor(q) });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No x-ray for ${recipInQuestion}.`),
          toolCalls,
        );
      const investigation = investigationOf('getXray', result);
      const spec = PROPOSAL_KINDS.REQUEST_VETERINARY_CONFIRMATION;
      const line = `Approval sends the request to the team under the approver's name (${spec.executes.split(' — ')[0]}); ${recipInQuestion} stays blocked until the vet records the result. A decline changes nothing.`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        investigation,
        answer: {
          statements: [{ text: line, evidence: [recipInQuestion], confidence: 'HIGH' }],
          abstentions: [],
          conflicts: [],
          summary: `It will not ${spec.willNot.join(', ')}; the rule runs again at the click, and refuses if her records moved.`,
        },
      };
    }

    // "Is she still blocked?" / "What happened with the request?" — read again, now: the request on record, and what still stands.
    if (
      recipInQuestion &&
      /\b(still|remains?|what happened|did (it|that) (go|send|work)|outcome|confirm(ed)?|went through|any change|now\??$)\b/i.test(
        q,
      ) &&
      !/\b(leave|depart)\b.*\bwhy\b/i.test(q)
    ) {
      const { result, record } = await call('getXray', { recipId: recipInQuestion, focus: focusFor(q) });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No x-ray for ${recipInQuestion}.`),
          toolCalls,
        );
      const investigation = investigationOf('getXray', result);
      const pending = investigation?.openRequests[0] ?? null;
      const cite = (...ids: (string | null | undefined)[]) =>
        Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
      // Two short sentences: the request on record, and what still stands; the subject and the rule's words sit in the facts and the summary.
      const requestLine = pending
        ? `Request ${pending.id} is open about ${recipInQuestion} since ${pending.since}.`
        : `No request to the team is open about ${recipInQuestion}.`;
      const standing = investigation?.authority
        ? `${recipInQuestion} remains blocked until ${ownerWord(investigation.authority.owner).toLowerCase()} records the result.`
        : `Nothing about ${recipInQuestion} waits on a person now.`;
      // The request is the news only when there is one, or when the question asked after it.
      const aboutRequest = pending !== null || /\b(request|happened|outcome|confirm|went through)\b/i.test(q);
      const statements = aboutRequest
        ? [
            { text: requestLine, evidence: cite(recipInQuestion, pending?.id), confidence: 'HIGH' as const },
            {
              text: standing,
              evidence: cite(recipInQuestion, investigation?.authority?.signalId),
              confidence: 'HIGH' as const,
            },
          ]
        : [
            {
              text: standing,
              evidence: cite(recipInQuestion, investigation?.authority?.signalId),
              confidence: 'HIGH' as const,
            },
          ];
      const summary = `${aboutRequest ? `${requestLine} ` : ''}${standing}${pending ? ` The request: “${pending.subject}”.` : ''}${investigation ? ` ${firstClauseOf(investigation.conclusion)}` : ''}`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        investigation,
        answer: { statements, abstentions: [], conflicts: [], summary },
      };
    }

    // "Prepare the vet request for R-0037" / "Ask the vet to confirm her" / "Prepare it." — a proposal, never a clearance.
    const prepareIt =
      /^\s*(please\s+)?(prepare|draft|go ahead|do)\b[^.?!]*\b(it|that|this|the request|the next step|one)\b/i.test(q) ||
      /^\s*(prepare|go ahead|do it)\.?\s*$/i.test(q);
    const vetRequestAsked =
      (prepareIt ||
        /\b(prepare|draft|request|ask|send)\b[^.?!]*\b(vet|veterinary)\b|\b(vet|veterinary)\b[^.?!]*\b(request|confirmation|confirm)\b|\bprepare (the )?next step\b/i.test(
          q,
        )) &&
      !/\b(mark|record|clear(ed)?\s+(her|the mare|for)|is\s+(she|R-\d)|cleared\?)/i.test(q);
    if (vetRequestAsked && recipInQuestion) {
      const { result, record } = await call('proposeAction', {
        kind: 'REQUEST_VETERINARY_CONFIRMATION',
        recipId: recipInQuestion,
        rationale: `Asked to prepare a veterinary confirmation request for ${recipInQuestion}.`,
      });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], 'could not prepare the request'),
          toolCalls,
        );
      if (result['error'] === 'ALREADY_PENDING') {
        // A pending request is an answer, not a failure: nothing new is prepared.
        const line = `Nothing new was prepared: ${text(result['detail'])}.`;
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [{ text: line, evidence: [recipInQuestion], confidence: 'HIGH' }],
            abstentions: [],
            conflicts: [],
            summary: line,
          },
        };
      }
      const proposalId = String(result['proposalId']);
      const subject = text(result['subject']);
      return {
        handled: true,
        toolCalls,
        proposalIds: [proposalId],
        answer: {
          statements: [
            {
              text: `Prepared, not sent: “${subject}”. Approve and it goes to the team under your name; decline and nothing happens.`,
              evidence: [recipInQuestion],
              confidence: 'HIGH',
            },
          ],
          abstentions: [],
          conflicts: [],
          summary: `A veterinary confirmation request for ${recipInQuestion} is prepared and waiting for a person. Nothing has changed: no clearance, no check and no message was recorded.`,
        },
      };
    }

    // "Hold R-0040 for E-26-0054" — a proposal, never a change.
    const hold =
      /\b(hold|assign|use|put|plan)\b.*?\b(R-\d{4,6})\b.*?\b(E-\d{2}-\d{4,6})\b|\b(E-\d{2}-\d{4,6})\b.*?\b(into|to|for|in)\s+(R-\d{4,6})\b/i.exec(
        q,
      );
    if (hold && /\b(hold|assign|use|put|plan|set aside|book)\b/i.test(q)) {
      const recipId = hold[2] ?? hold[6] ?? '';
      const embryoId = hold[3] ?? hold[4] ?? '';
      const { result, record } = await call('proposeAction', {
        kind: 'ASSIGN_PLANNED_RECIPIENT',
        embryoId,
        recipientId: recipId,
        rationale: `Asked to hold ${recipId} for ${embryoId}.`,
      });
      if (!record.ok)
        return this.abstainOn(q, 'NO_RECORD', text(result['detail'], 'could not create the proposal'), toolCalls);
      const preview = result['rulePreview'] as { ok: boolean; reason?: string; evidenceIds: string[] };
      const proposalId = String(result['proposalId']);
      return {
        handled: true,
        toolCalls,
        proposalIds: [proposalId],
        answer: {
          statements: [
            {
              text: preview.ok
                ? `Proposed: hold ${recipId} for ${embryoId}. The rule accepts it today; nothing changes until a person approves.`
                : `Proposed: hold ${recipId} for ${embryoId} — but the rule already refuses it: ${preview.reason ?? ''}`,
              evidence: Array.from(new Set([embryoId, recipId, ...preview.evidenceIds])).slice(0, 12),
              confidence: 'HIGH',
            },
          ],
          abstentions: [],
          conflicts: [],
          summary: preview.ok
            ? 'I can prepare that, not do it. Approve the proposal and the rule runs again; decline it and nothing happens.'
            : 'I prepared the proposal, and the rule refuses it as things stand. A person can still decide; the refusal will stand until the record changes.',
        },
      };
    }

    // A client's own questions — "Where are my embryos?", "What do I still owe?", "When does board
    // start?" — answered from her own record, the only one her role can read.
    if (actor.role === 'CUSTOMER' && actor.customerId && /\b(my|mine|i owe|do i|am i)\b/i.test(q)) {
      const { result, record } = await call('getCustomer', { id: actor.customerId });
      if (!record.ok)
        return this.abstainOn(q, 'ACCESS_DENIED', 'Your record could not be read with this sign-in.', toolCalls);
      const customerId = String(result['id']);
      const embryos =
        (result['embryos'] as {
          id: string;
          status: string;
          recip: { id: string; number: number | null } | null;
          latestCheck: { id: string; day: number; result: string; on: string } | null;
        }[]) ?? [];
      const invoices =
        (result['invoices'] as {
          id: string;
          kind: string;
          status: string;
          amountCents: number;
          paidCents: number;
        }[]) ?? [];
      const contracts = (result['contracts'] as { id: string; status: string; stallion: string; type: string }[]) ?? [];

      // "What do I still owe?" — the open invoices, one line each, and the total.
      if (/\b(owe|owed|balance|outstanding|unpaid|open invoice|still (owe|due)|what do i pay)\b/i.test(q)) {
        const open = invoices.filter((i) => i.status === 'OPEN');
        const total = open.reduce((sum, i) => sum + Math.max(0, i.amountCents - i.paidCents), 0);
        if (open.length === 0)
          return {
            handled: true,
            toolCalls,
            proposalIds: [],
            answer: {
              statements: [],
              abstentions: [],
              conflicts: [],
              summary: `Nothing is open on your account: ${invoices.filter((i) => i.status === 'PAID').length} invoice${invoices.length === 1 ? '' : 's'} paid, none outstanding.`,
            },
          };
        const statements = open.slice(0, 8).map((i) => ({
          text: `${i.id} (${i.kind.toLowerCase().replace(/_/g, ' ')}): ${formatUsd(i.amountCents - i.paidCents)} open${i.paidCents > 0 ? ` after ${formatUsd(i.paidCents)} paid` : ''}.`,
          evidence: [i.id, customerId],
          confidence: 'HIGH' as const,
        }));
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements,
            abstentions: [],
            conflicts: [],
            summary: `${formatUsd(total)} is open across ${open.length} invoice${open.length === 1 ? '' : 's'}${contracts.length ? ` on ${contracts.map((k) => k.id).join(', ')}` : ''}. Amounts are the ledger's as of now; a payment that has not settled is not yet counted.`,
          },
        };
      }

      // "When does board start on my recip?" — the published rule, and where each pregnancy stands against it.
      if (/\bboard\b/i.test(q)) {
        const carrying = embryos.filter((e) => e.recip && e.status !== 'OPEN' && e.status !== 'LOST');
        const boardInvoices = invoices.filter((i) => i.kind === 'BOARD');
        const statements = carrying.slice(0, 8).map((e) => {
          const c = e.latestCheck;
          const started =
            c !== null &&
            c.day >= HEARTBEAT_DAY &&
            c.result !== 'OPEN' &&
            c.result !== 'LOST' &&
            c.result !== 'UNCLEAR';
          const text = started
            ? `${e.id} on Recip #${e.recip?.number ?? '?'}: board runs from the day-${HEARTBEAT_DAY} heartbeat${c.day === HEARTBEAT_DAY ? ` recorded ${c.on} (${c.id})` : `; the latest check is day ${c.day} on ${c.on} (${c.id})`}.`
            : `${e.id} on Recip #${e.recip?.number ?? '?'}: no board yet — ${c ? `the latest check is day ${c.day} (${c.result.toLowerCase()}, ${c.on})` : 'no check is on record'}; board starts at the day-${HEARTBEAT_DAY} heartbeat.`;
          return {
            text,
            evidence: Array.from(new Set([e.id, e.recip?.id, c?.id].filter((x): x is string => Boolean(x)))),
            confidence: 'HIGH' as const,
          };
        });
        const summary =
          carrying.length === 0
            ? `None of your embryos is in a recip right now, so no board applies. Board starts at the day-${HEARTBEAT_DAY} heartbeat check, at ${formatUsd(FEES.boardPerDay)} a day.`
            : `Board starts at the day-${HEARTBEAT_DAY} heartbeat check and runs at ${formatUsd(FEES.boardPerDay)} a day; ${statements.filter((s) => s.text.includes('runs from')).length} of your ${carrying.length} pregnanc${carrying.length === 1 ? 'y' : 'ies'} ${carrying.length === 1 ? 'has' : 'have'} reached it${boardInvoices.length ? ` (board invoiced so far: ${boardInvoices.map((i) => `${i.id} ${formatUsd(i.amountCents)}`).join(', ')})` : ''}.`;
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: { statements, abstentions: [], conflicts: [], summary },
        };
      }

      // "Where are my embryos right now?" — each one, where it is and what the last scan found.
      const statements = embryos.slice(0, 12).map((e) => {
        const c = e.latestCheck;
        const ended = e.status === 'OPEN' || e.status === 'LOST';
        const where = e.recip
          ? `${ended ? 'was in' : 'in'} Recip #${e.recip.number ?? '?'} (${e.recip.id})`
          : e.status === 'FROZEN'
            ? 'frozen in storage'
            : e.status === 'EXPECTED'
              ? 'expected, not yet arrived'
              : e.status === 'ARRIVED'
                ? 'arrived, waiting for a recip'
                : e.status.toLowerCase();
        const standing = e.recip
          ? e.status === 'OPEN'
            ? ' — open, not pregnant'
            : e.status === 'LOST'
              ? ' — pregnancy lost'
              : ` — ${e.status.toLowerCase()}`
          : '';
        return {
          text: `${e.id}: ${where}${c ? `; day ${c.day} check ${c.result.toLowerCase()} on ${c.on} (${c.id})` : ''}${standing}.`,
          evidence: Array.from(new Set([e.id, e.recip?.id, c?.id].filter((x): x is string => Boolean(x)))),
          confidence: 'HIGH' as const,
        };
      });
      if (statements.length === 0)
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: { statements: [], abstentions: [], conflicts: [], summary: 'No embryos are on your record yet.' },
        };
      const carrying = embryos.filter((e) => e.recip && e.status !== 'OPEN' && e.status !== 'LOST').length;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements,
          abstentions: [],
          conflicts: [],
          summary: `${embryos.length} embryo${embryos.length === 1 ? '' : 's'} on your record: ${carrying} in a recip, ${embryos.filter((e) => e.status === 'FROZEN').length} frozen, ${embryos.filter((e) => e.status === 'EXPECTED' || e.status === 'ARRIVED').length} arriving or waiting for a recip. Each line cites the record it comes from.`,
        },
      };
    }

    // "What changed since yesterday?" / "What needs me today?" / "What is coming in the next 48 hours?" — the brief, against its own snapshot.
    const briefAsked =
      /\b(since yesterday|overnight|what(’s|'s| is| has)?\s*(changed|new)\b|morning brief|brief me|the brief\b|what needs me|needs? me today|next (48|forty.eight) hours|next two days|coming up|look ?ahead|what(’s|'s| is) (coming|ahead))/i.test(
        q,
      );
    if (briefAsked && !codes.length) {
      const { result, record } = await call('getBrief', {});
      if (!record.ok)
        return this.abstainOn(q, 'ACCESS_DENIED', 'The signed-in role may not read the operations brief.', toolCalls);
      const brief = result as unknown as OfflineBrief;
      const wantsAhead = /\b(next|coming|ahead|48|two days|tomorrow)\b/i.test(q);
      const wantsChanges = /\b(changed|new|since|overnight)\b/i.test(q);
      const wantsNeeds = (!wantsAhead && !wantsChanges) || /\b(morning|needs? me|brief)\b/i.test(q);
      const sinceLabel = brief.baseline
        ? `yesterday’s snapshot (${brief.baseline.takenAt.slice(0, 16).replace('T', ' ')} UTC)`
        : 'the last 24 hours — no snapshot from yesterday yet';
      const cite = (...ids: (string | null | undefined)[]) =>
        Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
      const statements: { text: string; evidence: string[]; confidence: 'HIGH' }[] = [];
      if (wantsNeeds)
        for (const r of brief.needsYou.slice(0, 3))
          statements.push({
            text: `Needs you: ${r.title}${r.atStake ? ` (${r.atStake}, ${r.waitingOn ?? 'held up'})` : ''} — ${r.next.toLowerCase()}.`,
            evidence: cite(r.id, r.entityId),
            confidence: 'HIGH',
          });
      if (wantsChanges || wantsNeeds) {
        for (const r of brief.sinceYesterday.raised.slice(0, 3))
          statements.push({
            text: `Raised since ${sinceLabel}: ${r.title}`,
            evidence: cite(r.id, r.entityId),
            confidence: 'HIGH',
          });
        for (const x of brief.sinceYesterday.resolved.slice(0, 2))
          statements.push({
            text: `Resolved since ${sinceLabel}: ${x.title}${x.resolution ? ` — ${x.resolution}` : ''}${x.by ? ` (${x.by})` : ''}.`,
            evidence: cite(x.id),
            confidence: 'HIGH',
          });
      }
      if (wantsAhead || wantsNeeds)
        for (const i of brief.next48Hours.filter((n) => n.entityId).slice(0, 4))
          statements.push({
            text: `${i.on}: ${i.label} — ${i.state}${i.note ? `, ${i.note}` : ''}${i.amount ? ` (${i.amount})` : ''}.`,
            evidence: cite(i.entityId),
            confidence: 'HIGH',
          });
      const blocked = brief.next48Hours.filter((i) => i.state === 'blocked').length;
      const changes = brief.sinceYesterday.changes.map((c) => `${c.count} in ${c.context}`).join(', ');
      const summary = `Since ${sinceLabel}: ${brief.sinceYesterday.raised.length} raised, ${brief.sinceYesterday.resolved.length} resolved${changes ? `; the audit trail recorded ${changes}` : '; nothing else recorded'}. ${brief.open} open now; ${brief.atStake} waits on a person. Next 48 hours: ${brief.next48Hours.length} item${brief.next48Hours.length === 1 ? '' : 's'}${blocked ? `, ${blocked} blocked` : ''}. Every line is read from the records now; nothing here changes them.`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements: statements.slice(0, 8), abstentions: [], conflicts: [], summary },
      };
    }

    // "What needs attention?" / "What could derail her cycle?" — explain the board, never scan tables.
    // "What's at stake today?" / "How much money is waiting on a person?" — the same board, in dollars.
    const moneyOnTheBoard =
      /\b(at stake|at risk|held up|tied up|waiting on (a person|someone|us|the vet|billing)|how much (money|is (waiting|held|blocked|stuck))|where is (the )?money|money (is )?(blocked|stuck|held|waiting))\b/i.test(
        q,
      ) && !codes.some((c) => c.startsWith('INV-') || c.startsWith('PAY-'));
    // "Why can't she leave?" / "What is blocking her?" — the x-ray: her records, the rules that read them, the person it waits for.
    const situation =
      Boolean(recipInQuestion) &&
      /\b(leave|leaving|depart|departure|go home|ready to go|blocking|blocked|not ready|situation|what is (wrong|going on) with)\b/i.test(
        q,
      );
    if (situation && recipInQuestion) {
      const { result, record } = await call('getXray', { recipId: recipInQuestion, focus: focusFor(q) });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No x-ray for ${recipInQuestion}.`),
          toolCalls,
        );
      const investigation = investigationOf('getXray', result);
      const blocked = (investigation?.rulesApplied ?? []).filter((r) => r.verdict === 'blocked');
      const signalId = investigation?.authority?.signalId ?? null;
      const cite = (...ids: (string | null | undefined)[]) =>
        Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
      const statements = [
        {
          text: investigation?.conclusion ?? `${recipInQuestion}: nothing waits on a person.`,
          evidence: cite(recipInQuestion, signalId),
          confidence: 'HIGH' as const,
        },
        ...blocked.slice(0, 3).map((r) => ({
          text: `${r.label} (${r.code}): ${r.reason ?? 'the rule did not pass'}`,
          evidence: cite(recipInQuestion, signalId),
          confidence: 'HIGH' as const,
        })),
        ...(investigation?.authority
          ? [
              {
                text: `Waits for ${investigation.authority.owner.toLowerCase().replace(/_/g, ' ')}: ${investigation.authority.reason}. Next: ${investigation.authority.next.toLowerCase()}.`,
                evidence: cite(recipInQuestion, signalId),
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      const summary = investigation?.authority
        ? `${investigation.conclusion} The next step is ${investigation.authority.owner.toLowerCase().replace(/_/g, ' ')}’s; the assistant can prepare it, not take it.`
        : (investigation?.conclusion ?? '');
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        investigation,
        answer: { statements, abstentions: [], conflicts: [], summary },
      };
    }

    // "What needs the vet?" — the board, one owner's share: the sources that owner acts on.
    const ownerAsked =
      /\b(needs?|waits? (on|for)|for) (the )?(vet|veterinary|billing|recip farm|recips|stallion office|office)\b/i
        .exec(q)?.[4]
        ?.toLowerCase() ?? null;
    if (
      moneyOnTheBoard ||
      ownerAsked ||
      /\b(attention|wrong|derail|risk|problem|exception|needs? a (person|human)|what should i worry)\b/i.test(q)
    ) {
      const entityId = codes[0] ?? recipInQuestion ?? null;
      const ownerRole = ownerAsked ? (OWNER_ROLE[ownerAsked] ?? null) : null;
      const { result, record } = await call(
        'getOpenExceptions',
        entityId ? { entityId } : ownerRole ? { owner: ownerRole } : {},
      );
      if (!record.ok)
        return this.abstainOn(q, 'ACCESS_DENIED', 'The signed-in role may not read the operations board.', toolCalls);
      const OWNER_SOURCES: Record<string, string[]> = {
        vet: ['VETERINARY'],
        veterinary: ['VETERINARY'],
        billing: ['BILLING', 'STRIPE', 'RECONCILIATION', 'QBO'],
        'recip farm': ['REPRODUCTION', 'INTAKE'],
        recips: ['REPRODUCTION', 'INTAKE'],
        'stallion office': ['BILLING'],
        office: ['QUEUE', 'INTEGRATION'],
      };
      const all =
        (result['exceptions'] as {
          id: string;
          kind: string;
          title: string;
          entityId: string | null;
          severity: string;
          source: string;
          since: string;
          atStake: { amount: string; waitingOn: string } | null;
        }[]) ?? [];
      const rows =
        ownerAsked && !ownerRole ? all.filter((r) => (OWNER_SOURCES[ownerAsked] ?? []).includes(r.source)) : all;
      if (rows.length === 0)
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [],
            abstentions: [
              {
                question: q.slice(0, 300),
                reason: 'NO_RECORD',
                detail: 'No open exception matches. The detectors run every minute; a quiet board is a true board.',
              },
            ],
            conflicts: [],
            summary: 'Nothing on the board matches the question right now.',
          },
        };
      const priced = rows.filter((r) => r.atStake);
      const atStake = text(result['atStake']);
      if (moneyOnTheBoard) {
        // Money first, largest first; the rows without a dollar are counted, not listed.
        const byAmount = [...priced].sort((a, b) => cents(b.atStake?.amount) - cents(a.atStake?.amount));
        const statements = byAmount.slice(0, 6).map((r) => ({
          text: `${r.atStake?.amount} — ${r.atStake?.waitingOn}: ${r.title}`,
          evidence: Array.from(new Set([r.id, ...(r.entityId ? [r.entityId] : [])])),
          confidence: 'HIGH' as const,
        }));
        const rest = rows.length - priced.length;
        const summary =
          priced.length === 0
            ? `Nothing on the board holds up money right now; ${rows.length} open item${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} a person for other reasons.`
            : `${atStake} is waiting on a person across ${priced.length} item${priced.length === 1 ? '' : 's'}${rest > 0 ? `; ${rest} more need${rest === 1 ? 's' : ''} a person without a dollar attached` : ''}. Each amount is read from the invoice or payment as it stands now; nothing here moves money.`;
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: { statements, abstentions: [], conflicts: [], summary },
        };
      }
      const statements = rows.slice(0, 6).map((r) => ({
        text: `${r.severity === 'CRITICAL' ? 'Critical' : r.severity === 'WARN' ? 'Warning' : 'Note'}: ${r.title}${r.atStake ? ` (${r.atStake.amount}, ${r.atStake.waitingOn})` : ''}`,
        evidence: Array.from(new Set([r.id, ...(r.entityId ? [r.entityId] : [])])),
        confidence: 'HIGH' as const,
      }));
      if (ownerAsked) {
        // One owner's work: how many, the sharpest deadline among them, one row per case, and the queue as the view.
        const owner = OWNER_ROLE[ownerAsked] ?? 'ADMIN';
        const soonest = rows
          .map((r) => /leaves (today|in (\d+) days?)/i.exec(r.title))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => (m[1]?.toLowerCase() === 'today' ? 0 : Number(m[2])))
          .sort((a, b) => a - b)[0];
        const noun = ownerAsked === 'vet' || ownerAsked === 'veterinary' ? 'veterinary' : ownerAsked;
        const lead = `${rows.length} case${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} ${noun} action.${soonest !== undefined ? ` One leaves ${soonest === 0 ? 'today' : `in ${soonest} day${soonest === 1 ? '' : 's'}`}.` : ''}`;
        const hints: CardHints = {
          answer: lead,
          rows: rows.slice(0, 3).map((r) => ({
            label: `${r.entityId ?? r.id} · ${EXCEPTIONS[r.kind as keyof typeof EXCEPTIONS]?.label ?? r.title}`,
            entityId: r.id,
            detail: agoShort(text(r.since)),
          })),
          view: { kind: 'worklist', owner },
        };
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          hints,
          answer: {
            statements,
            abstentions: [],
            conflicts: [],
            summary: `${lead} Each was raised by a rule; a person acts on the board.`,
          },
        };
      }
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements,
          abstentions: [],
          conflicts: [],
          summary: `${rows.length} open exception${rows.length === 1 ? '' : 's'} on the board${entityId ? ` touch ${entityId}` : ''}${priced.length > 0 && !entityId ? `; ${atStake} is waiting on a person` : ''}. Each was raised by a deterministic rule; a person resolves it on the Operations page.`,
        },
      };
    }

    // "Where is E-26-0052?" / "status of …"
    const embryoId = codes.find((c) => c.startsWith('E-'));
    if (embryoId && /\b(where|status|how is|what is|tell me about|show)\b/i.test(q)) {
      const { result, record } = await call('getEmbryo', { id: embryoId });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No record for ${embryoId}.`),
          toolCalls,
        );
      const transfers =
        (result['transfers'] as {
          id: string;
          recip: { id: string; number: number | null };
          performedOn: string;
          checks: { id: string; day: number; result: string; on: string }[];
        }[]) ?? [];
      const last = transfers[transfers.length - 1];
      const check = last?.checks[last.checks.length - 1];
      const line = last
        ? `${embryoId} was transferred into ${last.recip.id} (Recip #${last.recip.number ?? '?'}) on ${last.performedOn}${check ? `; the latest check (${check.id}, day ${check.day}, ${check.on}) found ${check.result.toLowerCase()}` : '; no check is recorded yet'}. Status: ${String(result['status']).toLowerCase()}.`
        : `${embryoId} has not been transferred; status ${String(result['status']).toLowerCase()}${result['storage'] ? ` in ${JSON.stringify(result['storage'])}` : ''}.`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [
            {
              text: line,
              evidence: Array.from(
                new Set([embryoId, last?.id, last?.recip.id, check?.id].filter((x): x is string => Boolean(x))),
              ),
              confidence: 'HIGH',
            },
          ],
          abstentions: [],
          conflicts: [],
          summary: line,
        },
      };
    }

    // "What is the lease fee?" — the published price list; no record to cite, so it rides in the summary.
    if (
      /\b(fee|fees|price|pricing|cost|costs|rate|how much (is|does|do))\b/i.test(q) &&
      !codes.length &&
      !/\b(owe|owes|balance|paid|outstanding)\b/i.test(q)
    ) {
      const summary = `Published fees, as the rules use them: recipient mare deposit ${formatUsd(FEES.recipDeposit)} at reservation; implant fee ${formatUsd(FEES.recipImplantPerAttempt)} per attempt, the first covered by the deposit; lease fee ${formatUsd(FEES.leaseFeeFlushOrThawed)} for a flushed or thawed embryo and ${formatUsd(FEES.leaseFeeFreshIcsi)} for fresh ICSI, due at the day-24 heartbeat; board ${formatUsd(FEES.boardPerDay)} a day from the heartbeat; re-aspiration chute fee ${formatUsd(FEES.reAspirationChute)}; a recip not returned as the sale requires, ${formatUsd(FEES.recipLateReturn)} (the sale names it; the lease says "the mare purchase price").`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements: [], abstentions: [], conflicts: [], summary },
      };
    }

    // "Is QuickBooks working?" / "is the sync failing?" — the board's word on the outside systems.
    if (
      /\b(quickbooks|qbo|stripe|sync|the books|redis|queue|circuit|breaker|integration)s?\b/i.test(q) &&
      /\b(working|ok|okay|healthy|down|failing|failed|broken|status|up|fine)\b/i.test(q) &&
      !codes.length
    ) {
      const { result, record } = await call('getOpenExceptions', {});
      if (!record.ok)
        return this.abstainOn(q, 'ACCESS_DENIED', 'The signed-in role may not read the operations board.', toolCalls);
      const rows = (
        (result['exceptions'] as {
          id: string;
          title: string;
          entityId: string | null;
          source: string;
          kind: string;
        }[]) ?? []
      ).filter((r) => ['QBO', 'STRIPE', 'QUEUE', 'INTEGRATION', 'RECONCILIATION'].includes(r.source));
      if (rows.length === 0)
        return {
          handled: true,
          toolCalls,
          proposalIds: [],
          answer: {
            statements: [],
            abstentions: [],
            conflicts: [],
            summary:
              'Nothing is open on the board about Stripe, QuickBooks or the queue right now: syncs are completing and no disagreement is waiting on a person.',
          },
        };
      const statements = rows.slice(0, 5).map((r) => ({
        text: `${r.source === 'QBO' || r.source === 'RECONCILIATION' ? 'Books' : r.source === 'STRIPE' ? 'Stripe' : 'Queue'}: ${r.title}`,
        evidence: Array.from(new Set([r.id, ...(r.entityId ? [r.entityId] : [])])),
        confidence: 'HIGH' as const,
      }));
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements,
          abstentions: [],
          conflicts: [],
          summary: `${rows.length} thing${rows.length === 1 ? '' : 's'} about the outside systems ${rows.length === 1 ? 'is' : 'are'} waiting on a person; nothing was lost, and each row says what to do.`,
        },
      };
    }

    // "What happened with PAY-26-0061?" / "did INV-26-0072 sync?" — one invoice or payment across three systems.
    const moneyId = codes.find((c) => c.startsWith('INV-') || c.startsWith('PAY-'));
    if (moneyId) {
      const { result, record } = await call('getMoneyTrail', { id: moneyId });
      if (!record.ok) {
        if (record.error === 'access denied')
          return this.abstainOn(
            q,
            'ACCESS_DENIED',
            text(result['detail'], `${moneyId} is not visible to this role.`),
            toolCalls,
          );
        const missing = this.abstainOn(
          q,
          'NO_RECORD',
          `I can't find ${moneyId} in the records. Payments and invoices live on the Money page.`,
          toolCalls,
        );
        return {
          ...missing,
          hints: { targets: [{ label: 'Open Money', entityId: moneyId, entityType: entityTypeOfCode(moneyId) }] },
        };
      }
      const invoice = result['invoice'] as {
        id: string;
        kind: string;
        status: string;
        amount: string;
        customer: { id: string; name: string };
      };
      const ledger = result['ledger'] as { status: string; note: string | null };
      const stripe = result['stripe'] as {
        status: string;
        ok: boolean;
        eventId: string | null;
        deliveries: number;
        duplicatesRejected: number;
      };
      const books = result['books'] as {
        status: string;
        ok: boolean;
        invoice: string | null;
        payment: string | null;
        note: string | null;
      };
      const steps =
        (result['steps'] as {
          at: string;
          source: string;
          title: string;
          detail: string | null;
          ok: boolean | null;
          ids: string[];
        }[]) ?? [];
      const open = Number(result['openDiscrepancies'] ?? 0);
      const paymentIds = steps.flatMap((s) => s.ids).filter((id) => id.startsWith('PAY-'));
      const evidence = Array.from(new Set([invoice.id, invoice.customer.id, ...paymentIds]));
      const statements = [
        {
          text: `${invoice.id} (${invoice.kind.toLowerCase().replace(/_/g, ' ')}, ${invoice.amount}, ${invoice.customer.name}) is ${invoice.status.toLowerCase()} in our ledger${ledger.note ? ` — ${ledger.note}` : ''}; Stripe says ${stripe.status.toLowerCase()}${stripe.eventId ? ` (${stripe.deliveries} deliver${stripe.deliveries === 1 ? 'y' : 'ies'}, ${stripe.duplicatesRejected} rejected as duplicate)` : ''}; the books say ${books.status.toLowerCase()}${books.note ? ` — ${books.note}` : ''}.`,
          evidence,
          confidence: 'HIGH' as const,
        },
        ...(steps.length
          ? [
              {
                text: `Latest steps: ${steps
                  .slice(-4)
                  .map((s) => `${s.source} ${s.title}${s.ok === false ? ' (failed)' : ''}`)
                  .join('; ')}.`,
                evidence,
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      // The card: three systems in one line, one fact per system, the trail as the view.
      const disagree = open > 0 || !books.ok || !stripe.ok;
      const hints: CardHints = {
        answer: `${invoice.id} (${invoice.amount}) is ${invoice.status.toLowerCase()} in the ledger; Stripe ${stripe.status.toLowerCase()}; the books ${books.status.toLowerCase()}.${disagree ? ' A person settles the difference on Money.' : ''}`,
        facts: [
          {
            label: 'Ledger',
            value: `${invoice.status.toLowerCase()}${ledger.note ? ` · ${ledger.note}` : ''}`,
            ref: invoice.id,
          },
          {
            label: 'Stripe',
            value: `${stripe.status.toLowerCase()}${stripe.eventId ? ` · ${stripe.deliveries} deliver${stripe.deliveries === 1 ? 'y' : 'ies'}, ${stripe.duplicatesRejected} rejected` : ''}`,
            ref: null,
          },
          { label: 'Books', value: `${books.status.toLowerCase()}${books.note ? ` · ${books.note}` : ''}`, ref: null },
        ],
        view: { kind: 'money-trail', id: moneyId },
      };
      const conflicts =
        open > 0 && paymentIds[0]
          ? [
              {
                ids: [invoice.id, paymentIds[0]],
                description: `The books and the ledger disagree about this money (${open} open discrepanc${open === 1 ? 'y' : 'ies'}); a person settles it on the Money page.`,
              },
            ]
          : [];
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        hints,
        answer: { statements, abstentions: [], conflicts, summary: statements.map((s) => s.text).join(' ') },
      };
    }

    // "When is she due to foal?" — the estimate, labelled as one, from the transfer on record.
    if (/\b(foal|foaling|due date|due to foal|when .* due)\b/i.test(q) && recipInQuestion) {
      const { result, record } = await call('getHorse', { id: recipInQuestion });
      if (!record.ok) return this.abstainOn(q, 'NO_RECORD', `No recip record for ${recipInQuestion}.`, toolCalls);
      const transfers =
        (result['transfers'] as { id: string; embryoId: string; embryoStatus: string; performedOn: string }[]) ?? [];
      const carrying = transfers.find((t) => t.embryoStatus === 'PREGNANT' || t.embryoStatus === 'TRANSFERRED');
      if (!carrying)
        return this.abstainOn(
          q,
          'NO_RECORD',
          `${recipInQuestion} is not carrying an embryo on the records, so there is no foaling date to estimate.`,
          toolCalls,
        );
      const line = `${recipInQuestion} was transferred ${carrying.embryoId} on ${carrying.performedOn}; foaling is expected around ${expectedFoalingOn(carrying.performedOn)} (an estimate at day 340 of gestation, not a record — the vet's checks set the real date).`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [
            { text: line, evidence: [recipInQuestion, carrying.id, carrying.embryoId], confidence: 'MEDIUM' },
          ],
          abstentions: [],
          conflicts: [],
          summary: line,
        },
      };
    }

    // A person's name in the question means the answer is about them, not about the day.
    const namedPerson = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/.exec(q)?.[1] ?? null;

    // "What's on today?" / "how many mares are carrying?" / "collection sheet" — the day sheet, in four lines.
    if (
      (/\b(today|tomorrow|day\s*sheet|collection|transfer\s+(sheet|list|day)|what'?s\s+(on|due|happening)|checks?\s+due|expected)\b/i.test(
        q,
      ) ||
        (/\b(how many|count|number of)\b/i.test(q) &&
          /\b(mares?|recips?|carrying|set up|embryos?|orders?|batch)/i.test(q))) &&
      !codes.length &&
      !namedPerson
    ) {
      const tomorrow = /\btomorrow\b/i.test(q);
      const { result, record } = await call('getDaySheet', {});
      if (!record.ok)
        return this.abstainOn(q, 'ACCESS_DENIED', 'The signed-in role may not read the day sheet.', toolCalls);
      const counters = result['counters'] as {
        recipFarm: { setUp: number; carrying: number; embryosExpected: number };
        south: { ordersOnHold: number; labBatchesOut: number };
      };
      const collection =
        (result['collection'] as {
          orderId: string;
          contractId: string;
          customer: string;
          stallion: string;
          disposition: string;
        }[]) ?? [];
      const expected =
        (result['embryosExpectedOrUnassigned'] as {
          embryoId: string;
          customer: string;
          status: string;
          expectedOn: string | null;
        }[]) ?? [];
      const checks =
        (result['checksDue'] as { transferId: string; embryoId: string; recipId: string; gestationDay: number }[]) ??
        [];
      const today = String(result['today']);
      const statements = [
        {
          text: `${today}: ${counters.recipFarm.setUp} recips set up, ${counters.recipFarm.carrying} carrying, ${counters.recipFarm.embryosExpected} embryos expected; ${counters.south.ordersOnHold} semen order${counters.south.ordersOnHold === 1 ? '' : 's'} on hold, ${counters.south.labBatchesOut} lab batch${counters.south.labBatchesOut === 1 ? '' : 'es'} out.`,
          evidence: [] as string[],
          confidence: 'HIGH' as const,
        },
        ...(collection.length
          ? [
              {
                text: `Collection: ${collection
                  .slice(0, 4)
                  .map((r) => `${r.orderId} ${r.customer} · ${r.stallion} · ${r.disposition.toLowerCase()}`)
                  .join('; ')}${collection.length > 4 ? ` and ${collection.length - 4} more` : ''}.`,
                evidence: collection.slice(0, 4).flatMap((r) => [r.orderId, r.contractId]),
                confidence: 'HIGH' as const,
              },
            ]
          : []),
        ...(expected.length
          ? [
              {
                text: `Embryos ${tomorrow ? 'due' : 'expected or unassigned'}: ${expected
                  .slice(0, 5)
                  .map((e) => `${e.embryoId} (${e.customer}${e.expectedOn ? `, ${e.expectedOn}` : ''})`)
                  .join(', ')}.`,
                evidence: expected.slice(0, 5).map((e) => e.embryoId),
                confidence: 'HIGH' as const,
              },
            ]
          : []),
        ...(checks.length
          ? [
              {
                text: `Checks due: ${checks
                  .slice(0, 5)
                  .map((c) => `${c.embryoId} in ${c.recipId} at day ${c.gestationDay}`)
                  .join(', ')}${checks.length > 5 ? ` and ${checks.length - 5} more` : ''}.`,
                evidence: checks.slice(0, 5).flatMap((c) => [c.embryoId, c.recipId]),
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      // The counters line has no record to cite; the verifier keeps only cited statements, so it rides in the summary.
      const cited = statements.filter((s) => s.evidence.length > 0);
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements: cited, abstentions: [], conflicts: [], summary: statements.map((s) => s.text).join(' ') },
      };
    }

    // "Tell me about R-0036" / "who owns H-0012" / "status of SS-26-0533" / "what does C-0004 have"
    const horseId = codes.find((c) => c.startsWith('R-') || c.startsWith('H-'));
    if (horseId && !embryoId) {
      const { result, record } = await call('getHorse', { id: horseId });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No record for ${horseId}.`),
          toolCalls,
        );
      const owner = result['owner'] as { id: string; name: string } | null;
      const transfers =
        (result['transfers'] as {
          id: string;
          embryoId: string;
          embryoStatus: string;
          performedOn: string;
          latestCheck: { id: string; day: number; result: string; on: string } | null;
        }[]) ?? [];
      const clearances =
        (result['clearances'] as { id: string; kind: string; result: string; performedOn: string }[]) ?? [];
      const last = transfers[0];
      const recipNumber = typeof result['recipNumber'] === 'number' ? result['recipNumber'] : null;
      const recipStatus = typeof result['recipStatus'] === 'string' ? result['recipStatus'] : null;
      const who = `${text(result['name'], horseId)} (${horseId}) is a ${text(result['kind']).toLowerCase().replace(/_/g, ' ')}${recipNumber ? `, Recip #${recipNumber}` : ''}${recipStatus ? `, ${recipStatus.toLowerCase().replace(/_/g, ' ')}` : ''}, at ${text(result['site']).toLowerCase().replace(/_/g, ' ')}${owner ? `, owned by ${owner.name}` : ''}.`;
      const carrying = last
        ? `Latest transfer ${last.id}: ${last.embryoId} on ${last.performedOn}, ${last.embryoStatus.toLowerCase()}${last.latestCheck ? `; last check ${last.latestCheck.id} day ${last.latestCheck.day} ${last.latestCheck.result.toLowerCase()} (${last.latestCheck.on})` : '; no check recorded'}.`
        : null;
      const cleared = clearances.length
        ? `Clearances on record: ${clearances
            .slice(0, 4)
            .map((c) => `${c.kind.toLowerCase().replace(/_/g, ' ')} ${c.result.toLowerCase()} (${c.performedOn})`)
            .join(', ')}.`
        : null;
      const statements = [
        { text: who, evidence: [horseId, ...(owner ? [owner.id] : [])], confidence: 'HIGH' as const },
        ...(carrying && last
          ? [
              {
                text: carrying,
                evidence: [horseId, last.id, last.embryoId, ...(last.latestCheck ? [last.latestCheck.id] : [])],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
        ...(cleared
          ? [
              {
                text: cleared,
                evidence: [horseId, ...clearances.slice(0, 4).map((c) => c.id)],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements, abstentions: [], conflicts: [], summary: statements.map((s) => s.text).join(' ') },
      };
    }

    const contractId = codes.find((c) => c.startsWith('SS-'));
    if (contractId) {
      const { result, record } = await call('getContract', { id: contractId });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No record for ${contractId}.`),
          toolCalls,
        );
      const customer = result['customer'] as { id: string; name: string };
      const stallion = result['stallion'] as { id: string; name: string };
      const fees = result['fees'] as { balance: string; balanceCents: number; paidCents: number; totalCents: number };
      const invoices = (result['invoices'] as { id: string; kind: string; status: string }[]) ?? [];
      const orders = (result['semenOrders'] as { id: string; status: string; requestedFor: string }[]) ?? [];
      const statements = [
        {
          text: `${contractId} is a ${String(result['type']).toLowerCase().replace(/_/g, ' ')} contract for ${customer.name} on ${stallion.name}, ${String(result['status']).toLowerCase().replace(/_/g, ' ')}; balance ${fees.balance} of ${(fees.totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`,
          evidence: [contractId, customer.id, stallion.id],
          confidence: 'HIGH' as const,
        },
        ...(invoices.length
          ? [
              {
                text: `Invoices: ${invoices.map((i) => `${i.id} ${i.kind.toLowerCase().replace(/_/g, ' ')} ${i.status.toLowerCase()}`).join(', ')}.`,
                evidence: [contractId, ...invoices.map((i) => i.id)],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
        ...(orders.length
          ? [
              {
                text: `Semen orders: ${orders
                  .slice(0, 4)
                  .map((o) => `${o.id} ${o.status.toLowerCase().replace(/_/g, ' ')} for ${o.requestedFor}`)
                  .join(', ')}.`,
                evidence: [contractId, ...orders.slice(0, 4).map((o) => o.id)],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements, abstentions: [], conflicts: [], summary: statements.map((s) => s.text).join(' ') },
      };
    }

    // A customer by code, or by name ("what does Jane Alder owe?", "show me Dale Whitfield")
    const customerId = codes.find((c) => c.startsWith('C-')) ?? (await this.customerByName(q, call));
    if (customerId) {
      const { result, record } = await call('getCustomer', { id: customerId });
      if (!record.ok)
        return this.abstainOn(
          q,
          record.error === 'access denied' ? 'ACCESS_DENIED' : 'NO_RECORD',
          text(result['detail'], `No record for ${customerId}.`),
          toolCalls,
        );
      const invoices =
        (result['invoices'] as {
          id: string;
          kind: string;
          status: string;
          amountCents: number;
          paidCents: number;
        }[]) ?? [];
      const embryos =
        (result['embryos'] as {
          id: string;
          status: string;
          recip: { id: string; number: number | null } | null;
          latestCheck: { id: string; day: number; result: string } | null;
        }[]) ?? [];
      const contracts = (result['contracts'] as { id: string; status: string; stallion: string }[]) ?? [];
      const horses = (result['horses'] as { id: string; name: string; kind: string }[]) ?? [];
      const owed = invoices.filter((i) => i.status === 'OPEN').reduce((s, i) => s + (i.amountCents - i.paidCents), 0);
      const money = /\b(owe|owes|balance|paid|outstanding|due|invoice|bill)/i.test(q);
      const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const statements = [
        {
          text: `${String(result['name'])} (${customerId}): ${horses.length} horse${horses.length === 1 ? '' : 's'}, ${contracts.length} contract${contracts.length === 1 ? '' : 's'}, ${embryos.length} embryo${embryos.length === 1 ? '' : 's'}.`,
          evidence: [customerId, ...horses.slice(0, 3).map((h) => h.id), ...contracts.slice(0, 3).map((c) => c.id)],
          confidence: 'HIGH' as const,
        },
        ...(embryos.length
          ? [
              {
                text: `Embryos: ${embryos
                  .slice(0, 5)
                  .map(
                    (e) =>
                      `${e.id} ${e.status.toLowerCase()}${e.recip ? ` in ${e.recip.id}` : ''}${e.latestCheck ? ` (day ${e.latestCheck.day} ${e.latestCheck.result.toLowerCase()})` : ''}`,
                  )
                  .join(', ')}.`,
                evidence: [customerId, ...embryos.slice(0, 5).map((e) => e.id)],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
        ...(money || invoices.length
          ? [
              {
                text: invoices.length
                  ? `Open balance ${usd(owed)} across ${invoices.filter((i) => i.status === 'OPEN').length} open invoice${invoices.filter((i) => i.status === 'OPEN').length === 1 ? '' : 's'}; ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} in all (${invoices
                      .slice(0, 4)
                      .map((i) => `${i.id} ${i.kind.toLowerCase().replace(/_/g, ' ')} ${i.status.toLowerCase()}`)
                      .join(', ')}).`
                  : 'No invoices are visible to the signed-in role.',
                evidence: [customerId, ...invoices.slice(0, 4).map((i) => i.id)],
                confidence: 'HIGH' as const,
              },
            ]
          : []),
      ];
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: { statements, abstentions: [], conflicts: [], summary: statements.map((s) => s.text).join(' ') },
      };
    }

    // A name or a fragment with no code: search, and say what was found.
    const fragment = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/.exec(q)?.[1] ?? null;
    if (fragment) {
      const { result, record } = await call('searchRecords', { query: fragment });
      const results = record.ok
        ? ((result['results'] as { id: string; type: string; title: string; subtitle: string }[]) ?? [])
        : [];
      if (results.length === 0)
        return this.abstainOn(
          q,
          'NO_RECORD',
          `Nothing matched "${fragment}" among embryos, horses, contracts and customers.`,
          toolCalls,
        );
      const line = `"${fragment}" matches ${results
        .slice(0, 6)
        .map((r) => `${r.title} (${r.id}, ${r.type}${r.subtitle ? `: ${r.subtitle}` : ''})`)
        .join('; ')}${results.length > 6 ? ` and ${results.length - 6} more` : ''}.`;
      return {
        handled: true,
        toolCalls,
        proposalIds: [],
        answer: {
          statements: [{ text: line, evidence: results.slice(0, 6).map((r) => r.id), confidence: 'HIGH' }],
          abstentions: [],
          conflicts: [],
          summary: `${line} Ask about one of them by its code.`,
        },
      };
    }

    return {
      handled: false,
      toolCalls,
      proposalIds: [],
      answer: this.abstain(
        q,
        'OUT_OF_SCOPE',
        'I answer from the records. Name a mare, an embryo, a payment or a lot by its code or name, or ask about the day, the board, or what needs a person.',
      ),
    };
  }

  /** "what does Jane Alder owe" → the one customer that name matches, or nothing. */
  private async customerByName(
    q: string,
    call: (name: string, input: unknown) => Promise<{ result: Record<string, unknown>; record: ToolCallRecord }>,
  ): Promise<string | null> {
    const fragment = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/.exec(q)?.[1] ?? null;
    if (!fragment) return null;
    const { result, record } = await call('searchRecords', { query: fragment });
    if (!record.ok) return null;
    const customers = ((result['results'] as { id: string; type: string }[]) ?? []).filter(
      (r) => r.type === 'customer',
    );
    return customers.length === 1 ? customers[0]!.id : null;
  }

  private abstainOn(
    q: string,
    reason: 'NO_RECORD' | 'ACCESS_DENIED',
    detail: string,
    toolCalls: ToolCallRecord[],
  ): OfflineOutcome {
    return { handled: true, toolCalls, proposalIds: [], answer: this.abstain(q, reason, detail) };
  }

  private abstain(q: string, reason: 'NO_RECORD' | 'ACCESS_DENIED' | 'OUT_OF_SCOPE', detail: string): AskAnswer {
    return {
      statements: [],
      abstentions: [{ question: q.slice(0, 300), reason, detail: detail.slice(0, 300) }],
      conflicts: [],
      summary: detail.slice(0, 600),
    };
  }
}

/** "$12,500.00" → 1250000; anything unreadable sorts last. */
function cents(formatted: string | undefined): number {
  const n = Number((formatted ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : -1;
}

/** What the question is about, for the x-ray to answer that signal: leaving, the check, or an embryo held for her. */
function focusFor(q: string): 'departure' | 'check' | 'recipient' | undefined {
  if (/\b(leave|leaving|depart|departure|go home|video)\b/i.test(q)) return 'departure';
  if (/\b(check|day.?\d{2}|overdue|heartbeat|ultrasound)\b/i.test(q)) return 'check';
  if (/\b(hold|held|embryo|conflict|second)\b/i.test(q)) return 'recipient';
  return undefined;
}

const OWNER_WORD: Record<string, string> = {
  VET: 'The vet',
  BILLING: 'Billing',
  RECIPS: 'The recip farm',
  STALLION_OFFICE: 'The stallion office',
  ADMIN: 'The office',
};
function ownerWord(owner: string): string {
  return OWNER_WORD[owner] ?? owner.toLowerCase().replace(/_/g, ' ');
}

/** "R-0037 leaves in 2 days and no video … is on record; the vet confirms …" → the clause before the semicolon, as a sentence. */
function firstClauseOf(sentence: string): string {
  const clause = sentence.split(';')[0]?.trim() ?? sentence.trim();
  return /[.!?]$/.test(clause) ? clause : `${clause}.`;
}

const OWNER_ROLE: Record<string, string> = {
  vet: 'VET',
  veterinary: 'VET',
  billing: 'BILLING',
  'recip farm': 'RECIPS',
  recips: 'RECIPS',
  'stallion office': 'STALLION_OFFICE',
  office: 'ADMIN',
};

/** "2d", "3h", "now": how long a row has waited, in the space a list row has. */
function agoShort(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return ms < 60_000 ? 'now' : `${Math.floor(ms / 60_000)}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function entityTypeOfCode(code: string): 'invoice' | 'payment' {
  return code.startsWith('PAY-') ? 'payment' : 'invoice';
}

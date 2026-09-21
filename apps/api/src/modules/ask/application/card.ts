import { can, type Actor, type AskAnswer } from '@daysheet/domain';
import type { Investigation } from './ask.tools';
import { entityTypeOf, resolveHref, targetFor, type Target, type TargetEntity, type TargetFocus } from './targets';

/**
 * The answer as the person reads it: one or two sentences, at most three facts, the doors into
 * the application and the acts the assistant may prepare. Built in code from what the tools
 * returned — never from the model's words — so a card can be trusted the way a tool result is:
 * the sentence is the rule's or the board's own, the facts are the graph's, the doors are the
 * application's addresses. The full answer (statements, evidence, abstentions) sits behind it.
 */
export interface CardFact {
  label: string;
  value: string;
  /** The record the fact is read from, when one code holds it. */
  ref: string | null;
}

export interface CardAction {
  label: string;
  /** What the act is, for the page; the question is how the assistant is asked to prepare it. */
  action: 'PREPARE_VET_REQUEST' | 'HOLD_RECIPIENT';
  question: string;
}

/**
 * What the application shows for an answer: not a route the model wrote, but one of the
 * application's own views, chosen by kind and resolved here. The workspace changes to it.
 */
export type CardView =
  | { kind: 'worklist'; label: string; href: string; owner: string }
  | { kind: 'entity'; label: string; href: string; entityId: string; focus: TargetFocus }
  | { kind: 'money-trail'; label: string; href: string; id: string }
  | { kind: 'decision'; label: string; href: string; id: string };

export interface AnswerCard {
  answer: string;
  facts: CardFact[];
  targets: Target[];
  actions: CardAction[];
  /** The view the workspace opens for this answer, when one fits. */
  view: CardView | null;
  /** The state the answer was read from: the tools' combined fingerprint. */
  stateId: string | null;
  subject: { entityType: TargetEntity; entityId: string } | null;
}

/**
 * What a composer knows that the card builder cannot read back from the tools' records: the
 * sentence it would lead with, three facts it already has in hand, rows for a list, and the
 * view the answer belongs in. Always optional; the builder derives the rest.
 */
export interface CardHints {
  answer?: string;
  facts?: CardFact[];
  rows?: { label: string; entityId: string; detail: string | null }[];
  view?:
    | { kind: 'worklist'; owner: string }
    | { kind: 'money-trail'; id: string }
    | { kind: 'entity'; entityId: string; focus?: TargetFocus }
    | null;
  targets?: { label: string; entityId: string; entityType?: TargetEntity }[];
}

export interface CardInput {
  question: string;
  answer: AskAnswer;
  investigation: Investigation | null;
  toolCalls: { name: string; input: unknown; ok: boolean; idsReturned: string[] }[];
  proposals: { id: string; kind: string; status: string; payload: Record<string, unknown>; spec: { label: string } }[];
  actor: Actor;
  /** The record the question was about, when the page or the conversation said so. */
  subjectId: string | null;
  stateId: string | null;
  hints?: CardHints | null;
}

const OWNER_TITLE: Record<string, string> = {
  VET: 'Vet work',
  BILLING: 'Billing work',
  RECIPS: 'Recip farm work',
  STALLION_OFFICE: 'Stallion office work',
  ADMIN: 'The office',
};

/** The application's own views, by kind; the href is the application's, never the model's. */
export function viewFor(hint: NonNullable<CardHints['view']>): CardView | null {
  switch (hint.kind) {
    case 'worklist':
      return {
        kind: 'worklist',
        label: `Open ${(OWNER_TITLE[hint.owner] ?? `${hint.owner.toLowerCase()} work`).toLowerCase()}`,
        href: `/operations?owner=${encodeURIComponent(hint.owner)}`,
        owner: hint.owner,
      };
    case 'money-trail': {
      const href = resolveHref(entityTypeOf(hint.id) ?? 'invoice', hint.id);
      return href ? { kind: 'money-trail', label: 'Show money trail', href, id: hint.id } : null;
    }
    case 'entity': {
      const type = entityTypeOf(hint.entityId);
      const href = type ? resolveHref(type, hint.entityId, hint.focus ?? null) : null;
      return href
        ? { kind: 'entity', label: `Open ${hint.entityId}`, href, entityId: hint.entityId, focus: hint.focus ?? null }
        : null;
    }
  }
}

const OWNER_WORD: Record<string, string> = {
  VET: 'vet',
  BILLING: 'billing',
  RECIPS: 'recip farm',
  STALLION_OFFICE: 'stallion office',
  ADMIN: 'office',
};
const FOCUS_BY_KIND: Record<string, TargetFocus> = {
  DEPARTURE_UNCONFIRMED: 'departure',
  CHECK_OVERDUE: 'checks',
  CLEARANCE_MISSING: 'clearances',
  RETURN_ASSESSMENT_MISSING: 'clearances',
};

/** The first `n` sentences of a text, whole; a rule's reason often runs on with a semicolon, which counts as a stop. */
export function firstSentences(text: string, n = 2): string {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .filter(Boolean);
  const chosen = parts.slice(0, n).join(' ');
  return chosen.length > 0 ? (/[.!?]$/.test(chosen) ? chosen : `${chosen}.`) : '';
}

/** The clause before a semicolon, as a sentence: "R-0037 leaves in 2 days and no video … is on record." */
function firstClause(text: string): string {
  const clause = text.split(';')[0]?.trim() ?? text.trim();
  return /[.!?]$/.test(clause) ? clause : `${clause}.`;
}

function ownerSentence(owner: string): string {
  return `The ${OWNER_WORD[owner] ?? owner.toLowerCase().replace(/_/g, ' ')} owns the next step.`;
}

const uniq = <T>(items: T[]) => Array.from(new Set(items));

export function buildCard(input: CardInput): AnswerCard {
  const { answer, investigation, toolCalls, proposals } = input;
  const hints = input.hints ?? null;
  const ran = (name: string) => toolCalls.some((t) => t.name === name && t.ok);
  const proposed = proposals[0] ?? null;
  const view = hints?.view ? viewFor(hints.view) : null;

  // An act was prepared: the card says so in the catalog's words and opens the record it is about.
  if (proposed) {
    const subjectId =
      ['recipId', 'recipientId', 'embryoId']
        .map((k) => proposed.payload[k])
        .find((v): v is string => typeof v === 'string') ?? null;
    return {
      answer:
        firstSentences(answer.statements[0]?.text ?? answer.summary, 2) ||
        `Prepared, not sent: ${proposed.spec.label}.`,
      facts: [],
      targets: subjectId
        ? [targetFor({ label: `Open ${subjectId}`, entityId: subjectId })].filter((t): t is Target => t !== null)
        : [],
      actions: [],
      view: null,
      stateId: input.stateId,
      subject: subjectId ? subjectOf(subjectId) : null,
    };
  }

  if (investigation) return fromInvestigation(input, investigation);

  // A list from the board or the brief: the sentence is the summary's, the rows are the signals it cited — or the composer's own rows.
  if (ran('getOpenExceptions') || ran('getBrief')) {
    const rows: Target[] = [];
    if (hints?.rows) {
      for (const r of hints.rows.slice(0, 3)) {
        const target = targetFor({ label: r.label, entityId: r.entityId, detail: r.detail ?? '' });
        if (target) rows.push(target);
      }
    } else {
      for (const s of answer.statements) {
        const signalId = s.evidence.find((id) => entityTypeOf(id) === 'signal');
        if (!signalId || rows.some((r) => r.entityId === signalId)) continue;
        const amount = /\$\d[\d,]*(?:\.\d{2})?/.exec(s.text)?.[0] ?? null;
        const target = targetFor({ label: titleOf(s.text), entityId: signalId, detail: amount ?? '' });
        if (target) rows.push(target);
        if (rows.length === 3) break;
      }
    }
    return {
      answer: firstSentences(hints?.answer || answer.summary || answer.statements[0]?.text || '', 2),
      facts: hints?.facts?.slice(0, 3) ?? [],
      targets: rows,
      actions: [],
      view,
      stateId: input.stateId,
      subject: input.subjectId ? subjectOf(input.subjectId) : null,
    };
  }

  // Everything else: the first statement, or nothing when the answer is an abstention, and a door to each record it cites.
  const sentence = hints?.answer ?? answer.statements[0]?.text ?? (answer.abstentions.length > 0 ? '' : answer.summary);
  const cited = uniq(answer.statements.flatMap((s) => s.evidence)).slice(0, 3);
  const targets = (hints?.targets ?? [])
    .map((t) => targetFor({ label: t.label, entityId: t.entityId, entityType: t.entityType ?? null }))
    .filter((t): t is Target => t !== null);
  for (const id of cited) {
    if (targets.some((t) => t.entityId === id)) continue;
    const target = targetFor({
      label: entityTypeOf(id) === 'lot' ? 'Open the sale' : `Open ${id}`,
      entityId: id,
      focus: ran('getRecipClearance') && entityTypeOf(id) === 'recipient' ? 'clearances' : null,
    });
    if (target) targets.push(target);
  }
  // The sale's page is the door for a settlement answer even when the sentence cites the payment first.
  const lotId = toolCalls
    .filter((t) => t.name === 'getSettlement' && t.ok)
    .flatMap((t) => t.idsReturned)
    .find((id) => entityTypeOf(id) === 'lot');
  if (lotId && !targets.some((t) => t.entityType === 'lot')) {
    const lot = targetFor({ label: 'Open the sale', entityId: lotId });
    if (lot) targets.unshift(lot);
  }
  // A view's door is not listed twice; a money trail already shows the invoice and the payment.
  const doors = targets
    .filter(
      (t) =>
        t.href !== view?.href &&
        !(view?.kind === 'money-trail' && (t.entityType === 'invoice' || t.entityType === 'payment')),
    )
    .slice(0, 3);
  return {
    answer: firstSentences(sentence ?? '', 2),
    facts: hints?.facts?.slice(0, 3) ?? [],
    targets: doors,
    actions: [],
    view,
    stateId: input.stateId,
    subject: input.subjectId ? subjectOf(input.subjectId) : null,
  };
}

/** "Needs you: R-0037 (Recip #37): the day-45 check was never recorded (…) — route to vet." → the title, short. */
function titleOf(text: string): string {
  const stripped = text.replace(/^(needs you|critical|warning|note|raised since[^:]*|resolved since[^:]*):\s*/i, '');
  const title = stripped.split(/\s+—\s+|\s+\(\$/)[0] ?? stripped;
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title;
}

function subjectOf(entityId: string): AnswerCard['subject'] {
  const entityType = entityTypeOf(entityId);
  return entityType ? { entityType, entityId } : null;
}

/**
 * The x-ray, read for the question: what blocks her in the rule's own words, the person who owns
 * the next step, three facts, and the doors — her record opened at the part that matters, the
 * graph beside the conversation, and the one act the assistant may prepare.
 */
function fromInvestigation(input: CardInput, investigation: Investigation): AnswerCard {
  const block = investigation.block;
  const authority = investigation.authority;
  const departure =
    investigation.rulesApplied.find((r) => r.label === 'DepartureRule' && r.verdict === 'blocked') ?? null;
  const askedToLeave = /\b(leave|leaving|depart|departure|go home)\b/i.test(input.question);
  // A follow-up ("who handles it", "is she still blocked", "what happens after") was answered in the statements' own words; the first question gets the rule's.
  const followUp =
    /\b(who|whose|what happens|then what|after|still|remains?|happened|outcome|confirm(ed)?|went through)\b/i.test(
      input.question,
    );
  const leadSentence =
    askedToLeave && departure?.reason ? firstClause(departure.reason) : firstSentences(investigation.conclusion, 1);
  const answer =
    followUp && input.answer.statements.length > 0
      ? firstSentences(input.answer.statements.map((s) => s.text).join(' '), 2)
      : authority
        ? `${leadSentence} ${ownerSentence(authority.owner)}`
        : leadSentence;

  const focus = block ? (FOCUS_BY_KIND[block.kind] ?? null) : null;
  const targets: Target[] = [];
  const open = targetFor({ label: `Open ${investigation.subject}`, entityId: investigation.subject, focus });
  if (open) targets.push(open);
  if (block) {
    const why = targetFor({ label: 'Show why', entityId: block.signalId, entityType: 'signal', peek: 'xray' });
    if (why) targets.push(why);
    if (block.entityId && block.entityId !== investigation.subject) {
      const other = targetFor({ label: `Open ${block.entityId}`, entityId: block.entityId });
      if (other) targets.push(other);
    }
  }

  // The vet request is offered once: an open request about her is a fact, not a second act.
  const mayPropose = can(input.actor, 'write', 'operations') || can(input.actor, 'write', 'embryo');
  const propose = investigation.availableActions.find((a) => a.kind === 'propose' && a.question);
  const pending = investigation.openRequests[0] ?? null;
  const actions: CardAction[] =
    propose && mayPropose && !pending
      ? [{ label: 'Prepare vet request', action: 'PREPARE_VET_REQUEST', question: propose.question ?? '' }]
      : [];
  const facts: CardFact[] = pending
    ? [
        { label: 'Request open', value: `${pending.subject} · since ${pending.since}`, ref: pending.id },
        ...investigation.facts.slice(0, 2),
      ]
    : investigation.facts.slice(0, 3);

  // The workspace opens her record at the part that matters; the list of doors does not repeat it.
  const view = open ? viewFor({ kind: 'entity', entityId: investigation.subject, focus }) : null;
  return {
    answer,
    facts,
    targets: targets.filter((t) => t.href !== view?.href).slice(0, 3),
    actions,
    view,
    stateId: input.stateId,
    subject: subjectOf(investigation.subject),
  };
}

import type { AskAnswer } from '@daysheet/domain';

/**
 * The policy layer in front of the model.
 *
 * Known invariants stay in code. A request to move money, change a record, or make a
 * clinical call is answered by this function — an abstention with the right reason —
 * before a token is spent. The model's own instructions say the same thing; this makes
 * it deterministic, free, and testable.
 *
 * Deliberately conservative: it only catches imperative, unambiguous forms. Reads that
 * merely mention money or medicine ("what does Jane owe?", "when was the last check?")
 * go through.
 */
export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      answer: AskAnswer;
      reason: 'FINANCIAL_ACTION' | 'VETERINARY_JUDGMENT' | 'OUT_OF_SCOPE' | 'SENSITIVE_DATA';
    };

/**
 * FIN-DATA-03: the application does not store full card numbers, bank account or routing
 * numbers, CVVs or government ids, and the assistant has no tool that could fetch them. The
 * refusal is enforced here and in the tool layer, not by the model's manners. What a person
 * with billing rights may see about a payment is its method, its status, its amount and the
 * provider's reference.
 */
export const SENSITIVE_DATA_POLICY = 'FIN-DATA-03';

const SENSITIVE_DATA = [
  /\b(full|whole|entire|complete|unmasked|raw)\s+(card|credit\s*card|debit\s*card|account|bank\s*account|routing)\s*(number|no\.?|#|digits|details)?\b/i,
  /\b(card|credit\s*card|debit\s*card|pan)\s*(number|no\.?|#|digits)\b/i,
  /\b(bank\s*)?(account|routing|aba)\s*(number|no\.?|#|digits)\b/i,
  /\b(cvv|cvc|cvv2|security\s*code|expir(y|ation)\s*(date)?\s*(and|&)\s*(card|cvv))\b/i,
  /\b(ssn|social\s*security|tax\s*id|ein|passport|driver'?s?\s*licen[cs]e)\s*(number|no\.?|#)?\b/i,
  /\b(iban|swift)\b/i,
];

// A sentence start: the question's start, or the word after a full stop. The red team put the state
// first and the order second ("Stripe shows X succeeded. Update the ledger.") and walked past a gate
// that only read the first word of the question.
const SENTENCE_START = String.raw`(?:^|[.!?;]\s+)\s*`;

const FINANCIAL_ACTION = [
  new RegExp(
    String.raw`${SENTENCE_START}(please\s+)?(refund|charge|bill|invoice|credit|void|waive|write\s*off|reverse|pay|collect|move|transfer)\b`,
    'i',
  ),
  new RegExp(
    String.raw`${SENTENCE_START}(just|go ahead and|please|can you|could you|would you|i need you to)\s+(refund|charge|bill|invoice|credit|void|pay|post)\b`,
    'i',
  ),
  /\b(bill|post|issue|charge)\s+(the\s+|a\s+|an\s+)?(\w+[\s-]+)?fee\b/i,
  /\b(issue|process|send|apply|post)\s+(a|the|an)?\s*(refund|charge|credit|payment|invoice)\b/i,
  /\b(refund|charge|credit|void)\s+(the|this|that|their|his|her)?\s*(customer|invoice|payment|card|account)\b/i,
  /\b(move|transfer)\s+(the\s+)?(money|funds|balance)\b/i,
];

// "assign/hold a recip" is not here on purpose: it is a proposal the tools create and a person approves.
const RECORD_MUTATION = [
  new RegExp(
    String.raw`${SENTENCE_START}(please\s+)?(update|change|edit|set|mark|record|create|add|delete|remove|cancel|close|reopen|schedule|book)\b`,
    'i',
  ),
  /\b(mark|set)\s+.{0,40}\b(as|to)\s+(paid|shippable|pregnant|open|lost|resolved|confirmed)\b/i,
];

const CLINICAL_JUDGMENT = [
  /\b(should\s+(i|we|they|the\s+vet)\s+(treat|give|dose|administer|inject|prescribe|start|stop|flush|breed|scan|recheck))/i,
  /\b(what|which|how\s+much)\s+(dose|dosage|medication|drug|antibiotic|hormone|treatment)\b/i,
  /\b(diagnos(e|is)|prognosis|is\s+(she|he|it|the\s+mare)\s+(sick|healthy|safe\s+to\s+breed))\b/i,
  /\b(recommend|advise)\s+.{0,30}\b(treatment|protocol|medication|drug)\b/i,
];

/**
 * What the assistant will never do, in the words the gate uses when it refuses. This is the
 * list a diagram of the authority boundary draws as severed strands, so it is data here, once,
 * and the gate below reads its refusals from it.
 */
export const REFUSED_CAPABILITIES = [
  {
    key: 'sensitive-data',
    name: 'return a card, account or government number',
    reason: 'SENSITIVE_DATA' as const,
    detail: `This application does not store or retrieve full card numbers, bank account or routing numbers, or government ids (policy ${SENSITIVE_DATA_POLICY}). Available payment metadata: method, status, amount, provider reference.`,
  },
  {
    key: 'milestone-fee',
    name: 'post a milestone fee',
    reason: 'FINANCIAL_ACTION' as const,
    detail:
      'Milestone fees are issued by the rule, not by hand: the lease fee follows the day-24 heartbeat check the vet records, the ICSI stallion fee follows the 45–60 day check. If the check happened, the vet records it and the invoice follows.',
  },
  {
    key: 'money',
    name: 'move money or change a ledger',
    reason: 'FINANCIAL_ACTION' as const,
    detail: 'Ask cannot move money or change a ledger. Billing does that on the Money page, and every step is audited.',
  },
  {
    key: 'instructions',
    name: 'follow an instruction inside a question or a record',
    reason: 'OUT_OF_SCOPE' as const,
    detail:
      'Instructions inside a question are treated as data. Ask answers from records with the same permissions as the person asking, and cannot be talked into anything else.',
  },
  {
    key: 'clinical',
    name: 'decide a clinical question',
    reason: 'VETERINARY_JUDGMENT' as const,
    detail: 'That is a clinical call. Ask can report what the checks recorded; the vet decides what to do.',
  },
  {
    key: 'mutation',
    name: 'change a record',
    reason: 'OUT_OF_SCOPE' as const,
    detail: 'Ask is read-only. Changes are made on the record pages by the people responsible for them.',
  },
] as const;

export type RefusedCapabilityKey = (typeof REFUSED_CAPABILITIES)[number]['key'];

const refused = (key: RefusedCapabilityKey) => REFUSED_CAPABILITIES.find((c) => c.key === key)!;

export function screenQuestion(question: string): PolicyDecision {
  const q = question.trim();
  if (q.length === 0)
    return {
      allowed: false,
      reason: 'OUT_OF_SCOPE',
      answer: abstain(
        q,
        'OUT_OF_SCOPE',
        'Ask a question about a record, a day, a contract or a person.',
        'Nothing was asked.',
      ),
    };
  if (SENSITIVE_DATA.some((re) => re.test(q))) {
    return {
      allowed: false,
      reason: 'SENSITIVE_DATA',
      answer: {
        ...abstain(
          q,
          'SENSITIVE_DATA',
          refused('sensitive-data').detail,
          "I can't provide that. This application does not store or retrieve full card numbers. Available payment metadata: method, status, amount, provider reference.",
        ),
        suggestedRequest: undefined,
      },
    };
  }
  if (FINANCIAL_ACTION.some((re) => re.test(q))) {
    if (/\b(lease|board|stallion|icsi)\s*fee\b/i.test(q)) {
      // The one money action people ask for by name has no manual path at all.
      return {
        allowed: false,
        reason: 'FINANCIAL_ACTION',
        answer: abstain(
          q,
          'FINANCIAL_ACTION',
          refused('milestone-fee').detail,
          'Ask cannot post a fee. The day-24 heartbeat check issues the lease fee when the vet records it. Ask can send that request to the vet team.',
        ),
      };
    }
    return {
      allowed: false,
      reason: 'FINANCIAL_ACTION',
      answer: abstain(
        q,
        'FINANCIAL_ACTION',
        refused('money').detail,
        'Money actions belong to a person on the Money page. Ask can tell you what the records say and hand the request to billing.',
      ),
    };
  }
  if (
    /ignore (your|all|previous|the) (instructions|rules|guardrails)|you are now|pretend (you|to be)|developer mode|system prompt/i.test(
      q,
    )
  ) {
    return {
      allowed: false,
      reason: 'OUT_OF_SCOPE',
      answer: abstain(
        q,
        'OUT_OF_SCOPE',
        refused('instructions').detail,
        'Ask only answers from records. Nothing in a question can change what it is allowed to do.',
      ),
    };
  }
  if (CLINICAL_JUDGMENT.some((re) => re.test(q))) {
    return {
      allowed: false,
      reason: 'VETERINARY_JUDGMENT',
      answer: abstain(
        q,
        'VETERINARY_JUDGMENT',
        refused('clinical').detail,
        'Clinical decisions belong to the veterinary team. Ask can summarize the recorded checks and send the question to them.',
      ),
    };
  }
  if (RECORD_MUTATION.some((re) => re.test(q))) {
    return {
      allowed: false,
      reason: 'OUT_OF_SCOPE',
      answer: abstain(
        q,
        'OUT_OF_SCOPE',
        refused('mutation').detail,
        'Ask cannot change records. It can tell you what they say and send the request to the team that owns them.',
      ),
    };
  }
  return { allowed: true };
}

/** Which refused capability an abstention detail came from, for a diagram that lights the strand the boundary held on. */
export function refusedCapabilityFor(detail: string | undefined): RefusedCapabilityKey | null {
  if (!detail) return null;
  return REFUSED_CAPABILITIES.find((c) => c.detail === detail)?.key ?? null;
}

function abstain(
  question: string,
  reason: 'FINANCIAL_ACTION' | 'VETERINARY_JUDGMENT' | 'OUT_OF_SCOPE' | 'SENSITIVE_DATA',
  detail: string,
  summary: string,
): AskAnswer {
  return {
    statements: [],
    abstentions: [{ question: question.slice(0, 300), reason, detail: detail.slice(0, 300) }],
    conflicts: [],
    summary,
    suggestedRequest: {
      subject: question.slice(0, 120),
      body: `Asked of the assistant, routed to people: ${question.slice(0, 400)}`,
      evidenceIds: [],
    },
  };
}

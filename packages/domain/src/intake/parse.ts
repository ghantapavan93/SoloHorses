/**
 * Embryo intake by text message.
 *
 * The public rule: "Text every cross to the Recip Farm … A text is not confirmed until we
 * reply." Texts arrive as free prose from vets and owners. This parser is deliberately
 * deterministic — regular expressions, not a model — so the office can predict what it will
 * and won't catch, and so a person always confirms before a record exists.
 *
 * Required fields, from the published intake page:
 *   fresh flush : sire, dam, donor ovulation date, expected flush/arrival date
 *   ICSI        : sire, dam, ICSI date, number of embryos
 *   thawed      : storage location, requested timing
 */

export type IntakeKind = 'ICSI' | 'FLUSH' | 'THAWED' | 'UNKNOWN';

/**
 * FACT (recipient leasing): the vet texts on ovulation day and again on shipment day. The
 * first lets the farm synchronize a recipient; the second says an embryo is on its way.
 */
export type IntakeStage = 'OVULATION' | 'SHIPMENT' | 'UNKNOWN';

/** ASSUMPTION: a fresh flush recovers the embryo about eight days after ovulation. */
export const FLUSH_DAYS_AFTER_OVULATION = 8;

export interface IntakeParse {
  kind: IntakeKind;
  /** Which of the two texts this is. */
  stage: IntakeStage;
  /** For an ovulation notice on a flush: the day the embryo is expected to be recovered. */
  expectedFlushOn: string | null;
  sireName: string | null;
  damName: string | null;
  /** ISO date of the ICSI / ovulation / flush event, if stated. */
  eventDate: string | null;
  embryoCount: number | null;
  storage: string | null;
  sendingVet: string | null;
  /** Free-text arrival expectation, e.g. "Tue by 1pm". Left as text; a person confirms the date. */
  expectedArrival: string | null;
  missing: IntakeField[];
  /** 0–1: how many of the fields we expected for this kind were found. */
  confidence: number;
}

export type IntakeField = 'sireName' | 'damName' | 'eventDate' | 'embryoCount' | 'storage' | 'expectedArrival';

const REQUIRED: Record<IntakeKind, IntakeField[]> = {
  ICSI: ['sireName', 'damName', 'eventDate', 'embryoCount'],
  FLUSH: ['sireName', 'damName', 'eventDate', 'expectedArrival'],
  THAWED: ['sireName', 'damName', 'storage'],
  UNKNOWN: ['sireName', 'damName'],
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const NAME = "[A-Za-z][A-Za-z'.\\- ]{1,60}?";

const LEADING_NOISE = [
  /^(?:(?:hey|hi|hello|thanks|its|it's|this is|we|i|im|i'm|have|got|are|will be|gonna|going to|should be|need to|want to|also|and|plus|so)\s+)+/i,
  /^(?:dr\.?\s+[a-z'-]+\s+)?(?:sending|sent|send|shipping|ship|bringing|have|got|has)\s+(?:you\s+|over\s+)?/i,
  /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|another|single)\s+(?:icsi\s+|fresh\s+|frozen\s+)?(?:embryos?|embies|blasts?)\s+(?:(?:coming|arriving|sent|shipped|headed)\s+)?(?:from|of|by|for|to you)?\s*/i,
  /^(?:cross|crossed|breeding|embryos?|embies|icsi|fresh flush|flush|frozen embryo|frozen|thawed|from|of|for|our|my|on)\s*:?\s+/i,
];

/** Words that end a dam's name when the sender keeps typing: "… x Miss Tally coming Tue". */
const TRAILING_NOISE =
  /\s+(?:this|next|coming|arriv\w*|ship\w*|fedex|ups|overnight\w*|tomorrow|today|tonight|please|thanks|thank|will|should|due|sending|expect\w*|want\w*|need\w*|and|&|plus|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|sat\w*|sun\w*|icsi|ov\w*|flush\w*|frozen|fresh|dr\.?|\d).*$/i;

function clean(name: string | undefined, side: 'sire' | 'dam' = 'sire'): string | null {
  if (!name) return null;
  let value = name.replace(/\s+/g, ' ').trim();
  let previous = '';
  while (previous !== value) {
    previous = value;
    for (const pattern of LEADING_NOISE) value = value.replace(pattern, '');
  }
  if (side === 'dam') value = value.replace(TRAILING_NOISE, '');
  value = value.replace(/[,.;:]+$/, '').trim();
  return value.length >= 2 ? value : null;
}

/** Shipping words mean the embryo is moving; ovulation words without them mean the heads-up. */
function detectStage(body: string): IntakeStage {
  const lower = body.toLowerCase();
  const shipping =
    /\b(ship\w*|sent|sending|fedex|ups|courier|overnight\w*|on (its|the) way|arriv\w*|coming|landing|flight|counted|in the tank|frozen)\b/.test(
      lower,
    );
  const ovulation = /\b(ovulat\w*|\bov\b|ovs)\b/.test(lower) || /\bov\s+\d/.test(lower);
  if (shipping) return 'SHIPMENT';
  if (ovulation) return 'OVULATION';
  return 'UNKNOWN';
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function detectKind(body: string): IntakeKind {
  const lower = body.toLowerCase();
  if (/\bicsi\b/.test(lower)) return 'ICSI';
  if (/\b(frozen|thaw(ed)?|vitrified|in (the |a )?tank)\b/.test(lower)) return 'THAWED';
  if (/\b(flush(ed|ing)?|ovulat(ed|ion)|ov\b)/.test(lower)) return 'FLUSH';
  return 'UNKNOWN';
}

/** Parse "9/14", "9/14/26", "9-14-2026", "Sep 14" against a reference year. */
export function parseLooseDate(text: string, referenceYear: number): string | null {
  const numeric = /(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/.exec(text);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let year = referenceYear;
    if (numeric[3]) year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text);
  if (named) {
    const month = months.indexOf((named[1] ?? '').toLowerCase()) + 1;
    const day = Number(named[2]);
    return `${referenceYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function findCross(body: string): { sire: string | null; dam: string | null } {
  // "Sire x Dam" — the industry convention puts the sire first.
  const xForm = new RegExp(
    `(${NAME})\\s+(?:x|X|×)\\s+(${NAME})(?=$|[,.;\\n]|\\s+(?:icsi|ov|ovulat|flush|frozen|fresh|\\d|dr\\b|arriv|ship|coming|expect))`,
    'i',
  );
  const x = xForm.exec(body);
  if (x) return { sire: clean(x[1], 'sire'), dam: clean(x[2], 'dam') };

  // "out of Dam by Sire" / "Dam by Sire"
  const outOf = new RegExp(`out of\\s+(${NAME})\\s+by\\s+(${NAME})(?=$|[,.;\\n]|\\s+\\d)`, 'i').exec(body);
  if (outOf) return { sire: clean(outOf[2], 'sire'), dam: clean(outOf[1], 'dam') };

  const sireLabel = new RegExp(`sire[:\\s]+(${NAME})(?=$|[,.;\\n]|\\s+dam)`, 'i').exec(body);
  const damLabel = new RegExp(`dam[:\\s]+(${NAME})(?=$|[,.;\\n]|\\s+sire|\\s+\\d)`, 'i').exec(body);
  return { sire: clean(sireLabel?.[1], 'sire'), dam: clean(damLabel?.[1], 'dam') };
}

function findEventDate(body: string, kind: IntakeKind, referenceYear: number): string | null {
  const keyed =
    /\b(?:icsi(?:'?d| date| on)?|ovulat(?:ed|ion)(?: date| on)?|ov|flushed?|fertiliz(?:ed|ation))\b[:\s]*(?:on\s+)?([A-Za-z]{3,9}\.?\s+\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/i.exec(
      body,
    );
  if (keyed?.[1]) return parseLooseDate(keyed[1], referenceYear);
  if (kind === 'UNKNOWN') return null;
  // Fall back to the first date-looking token that is not part of a time ("1pm", "1:00").
  const any = /(?<![:\d])(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)(?!\s*(?:am|pm|:))/i.exec(body);
  return any?.[1] ? parseLooseDate(any[1], referenceYear) : null;
}

function findCount(body: string): number | null {
  const digits = /(\d{1,2})\s*(?:x\s*)?(?:embryos?|embies|blasts?|blastocysts?)\b/i.exec(body);
  if (digits?.[1]) return Number(digits[1]);
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:embryos?|blasts?)\b/i.exec(body);
  if (words?.[1]) return NUMBER_WORDS[words[1].toLowerCase()] ?? null;
  if (/\b(?:an|a single|1)\s+embryo\b/i.test(body)) return 1;
  return null;
}

function findStorage(body: string): string | null {
  const tank = /\b(tank\s*#?\s*\w+(?:[,\s]+(?:slot|cane|canister)\s*#?\s*\w+)?)/i.exec(body);
  if (tank?.[1]) return tank[1].replace(/\s+/g, ' ').trim();
  const at = /\b(?:stored|frozen|sitting|held)\s+(?:at|with|in)\s+([A-Z][A-Za-z'.\- ]{2,40}?)(?=$|[,.;\n])/.exec(body);
  if (at?.[1]) return at[1].trim();
  if (/\bfrozen\b/i.test(body)) return 'frozen (location not stated)';
  return null;
}

function findVet(body: string): string | null {
  const dr = /\b(Dr\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)/.exec(body);
  if (dr?.[1]) return dr[1].replace(/^Dr\s/, 'Dr. ');
  const from =
    /\bfrom\s+([A-Z][A-Za-z'\- ]{2,30}?(?:Vet(?:erinary)?|Clinic|Equine|Repro(?:duction)?)[A-Za-z ]{0,20})/.exec(body);
  return from?.[1]?.trim() ?? null;
}

function findArrival(body: string): string | null {
  const patterns = [
    /\b((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?(?:\s+(?:by|at|before|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)/i,
    /\b((?:tomorrow|today|tonight)(?:\s+(?:by|at|before|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)/i,
    /\b(?:arriv(?:es|ing|al)|coming|shipping|ships|fedex|ups|overnight(?:ed)?|counter[- ]to[- ]counter)\b[^.,;\n]{0,40}/i,
  ];
  for (const p of patterns) {
    const m = p.exec(body);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return null;
}

export interface ParseOptions {
  /** Year used for dates written without one ("ICSI 9/14"). */
  referenceYear: number;
}

export function parseIntakeMessage(body: string, options: ParseOptions): IntakeParse {
  const text = body.replace(/\s+/g, ' ').trim();
  const kind = detectKind(text);
  const { sire, dam } = findCross(text);

  const stage = detectStage(text);
  const eventDate = findEventDate(text, kind, options.referenceYear);
  const parse: IntakeParse = {
    kind,
    stage,
    expectedFlushOn:
      stage === 'OVULATION' && kind === 'FLUSH' && eventDate
        ? shiftIsoDate(eventDate, FLUSH_DAYS_AFTER_OVULATION)
        : null,
    sireName: sire,
    damName: dam,
    eventDate,
    embryoCount: findCount(text),
    storage: findStorage(text),
    sendingVet: findVet(text),
    expectedArrival: findArrival(text),
    missing: [],
    confidence: 0,
  };

  const required = REQUIRED[kind];
  parse.missing = required.filter((field) => parse[field] === null);
  parse.confidence = required.length === 0 ? 1 : (required.length - parse.missing.length) / required.length;
  return parse;
}

export function requiredFieldsFor(kind: IntakeKind): readonly IntakeField[] {
  return REQUIRED[kind];
}

export type InboundClass = 'STOP' | 'HELP' | 'INTAKE' | 'OTHER';

/** Carrier-mandated keywords are honoured before anything else is attempted. */
export function classifyInbound(body: string): InboundClass {
  const word = body.trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)\b/.test(word)) return 'STOP';
  if (/^(help|info)\b/.test(word)) return 'HELP';
  if (/\b(embryo|embryos|icsi|flush|cross|x\s|ovulat|frozen|blast)/i.test(body)) return 'INTAKE';
  return 'OTHER';
}

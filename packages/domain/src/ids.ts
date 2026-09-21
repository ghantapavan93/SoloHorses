/**
 * Human-readable identifiers.
 *
 * The barn talks in codes: "E-26-2041 went into R-0347". Every entity a person cites gets a
 * code of the form PREFIX-YY-NNNN (season-scoped) or PREFIX-NNNN (permanent). These codes are
 * primary keys, evidence chips in the assistant, and audit-trail subjects — one vocabulary.
 */

export const ID_PREFIXES = {
  customer: 'C',
  horse: 'H',
  recip: 'R',
  contract: 'SS',
  semenOrder: 'SO',
  aspiration: 'ASP',
  labBatch: 'LAB',
  embryo: 'E',
  transfer: 'TR',
  check: 'CHK',
  invoice: 'INV',
  payment: 'PAY',
  refund: 'REF',
  exception: 'OX',
  clearance: 'CLR',
  lot: 'LOT',
  document: 'DOC',
  request: 'RQ',
  proposal: 'DEC',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Kinds whose codes are permanent (no season segment). */
const PERMANENT: ReadonlySet<IdKind> = new Set<IdKind>(['customer', 'horse', 'recip']);

/** Matches any code we hand out: E-26-2041, R-0347, SS-26-0533, CHK-26-0912 … */
export const ENTITY_ID_PATTERN =
  /^(C|H|R|SS|SO|ASP|LAB|E|TR|CHK|INV|PAY|REF|OX|CLR|LOT|DOC|RQ|DEC)-(?:(\d{2})-)?(\d{4,6})$/;

export function isEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

export interface ParsedEntityId {
  kind: IdKind;
  prefix: string;
  season: number | null;
  sequence: number;
}

const PREFIX_TO_KIND = new Map<string, IdKind>(
  (Object.entries(ID_PREFIXES) as [IdKind, string][]).map(([kind, prefix]) => [prefix, kind]),
);

export function parseEntityId(value: string): ParsedEntityId | null {
  const match = ENTITY_ID_PATTERN.exec(value);
  if (!match) return null;
  const [, prefix, seasonRaw, seqRaw] = match;
  const kind = PREFIX_TO_KIND.get(prefix ?? '');
  if (!kind || !seqRaw) return null;
  return {
    kind,
    prefix: prefix ?? '',
    season: seasonRaw ? 2000 + Number(seasonRaw) : null,
    sequence: Number(seqRaw),
  };
}

export function formatEntityId(kind: IdKind, sequence: number, season?: number): string {
  const prefix = ID_PREFIXES[kind];
  const seq = String(sequence).padStart(4, '0');
  if (PERMANENT.has(kind)) return `${prefix}-${seq}`;
  if (season === undefined) {
    throw new Error(`${kind} identifiers are season-scoped; a season year is required`);
  }
  return `${prefix}-${String(season % 100).padStart(2, '0')}-${seq}`;
}

/** Pull every entity code out of free text (tool results, model output, SMS bodies). */
// Built from ID_PREFIXES so a new kind of code cannot be forgotten here.
const EXTRACT_PATTERN = new RegExp(`\\b(?:${Object.values(ID_PREFIXES).join('|')})-(?:\\d{2}-)?\\d{4,6}\\b`, 'g');

export function extractEntityIds(text: string): string[] {
  const found = text.match(EXTRACT_PATTERN);
  return found ? Array.from(new Set(found)) : [];
}

/**
 * Where an answer can send a person. The assistant never writes a route: it names a record and,
 * at most, the part of it that matters (`focus`), and this table turns that into one of the
 * application's own addresses. A record the application has no page for resolves to nothing,
 * and the answer simply offers no door — never a guessed one.
 */
export type TargetEntity =
  | 'recipient'
  | 'horse'
  | 'embryo'
  | 'contract'
  | 'customer'
  | 'invoice'
  | 'payment'
  | 'signal'
  | 'decision'
  | 'lot'
  | 'board'
  | 'requests';

/** The part of a record an answer is about: the page opens scrolled to it and lit. */
export type TargetFocus = 'checks' | 'departure' | 'clearances' | null;

export interface Target {
  label: string;
  entityType: TargetEntity;
  entityId: string;
  focus: TargetFocus;
  href: string;
  /** A door that opens beside the conversation rather than instead of it. */
  peek: 'xray' | null;
  /** One number or word beside the label — a stake, a status — when the row is a list. */
  detail: string | null;
}

const PREFIXES: [RegExp, TargetEntity][] = [
  [/^R-\d{4,}$/, 'recipient'],
  [/^H-\d{4,}$/, 'horse'],
  [/^E-\d{2}-\d{4,}$/, 'embryo'],
  [/^SS-\d{2}-\d{4,}$/, 'contract'],
  [/^C-\d{4,}$/, 'customer'],
  [/^INV-\d{2}-\d{4,}$/, 'invoice'],
  [/^PAY-\d{2}-\d{4,}$/, 'payment'],
  [/^OX-\d{2}-\d{4,}$/, 'signal'],
  [/^LOT-\d{2}-\d{4,}$/, 'lot'],
  [/^RQ-\d{2}-\d{4,}$/, 'requests'],
];

export function entityTypeOf(id: string): TargetEntity | null {
  return PREFIXES.find(([pattern]) => pattern.test(id))?.[1] ?? null;
}

/** The application's address for a record, or null when it has none. Pure; the table is the whole policy. */
export function resolveHref(entityType: TargetEntity, entityId: string, focus: TargetFocus = null): string | null {
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case 'recipient':
    case 'horse':
      return `/horses/${id}${focus ? `?focus=${focus}` : ''}`;
    case 'embryo':
      return `/embryos/${id}`;
    case 'contract':
      return `/contracts/${id}`;
    case 'customer':
      return `/customers/${id}`;
    case 'invoice':
    case 'payment':
      return `/money?focus=${id}`;
    case 'signal':
      return `/signals/${id}`;
    case 'decision':
      return `/decisions/${id}`;
    case 'lot':
      return '/settlement';
    case 'board':
      return '/operations';
    case 'requests':
      return '/operations?tab=requests';
  }
}

/** A target for a record, when the application has a page for it. */
export function targetFor(input: {
  label: string;
  entityId: string;
  entityType?: TargetEntity | null;
  focus?: TargetFocus;
  peek?: 'xray' | null;
  detail?: string | null;
}): Target | null {
  const entityType = input.entityType ?? entityTypeOf(input.entityId);
  if (!entityType) return null;
  const focus = input.focus ?? null;
  const href = resolveHref(entityType, input.entityId, focus);
  if (!href) return null;
  return {
    label: input.label,
    entityType,
    entityId: input.entityId,
    focus,
    href,
    peek: input.peek ?? null,
    detail: input.detail ?? null,
  };
}

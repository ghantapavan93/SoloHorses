import { ENTITY_ID_PATTERN } from '../ids';

/**
 * What the assistant may remember: preferences about how to work with a person, never facts
 * about the operation. A remembered "R-0036 is usually fine" or "she generally approves this
 * fee" is a learned policy nobody wrote, and it would outlive the record it came from. Those
 * live in the rules and the rows, or nowhere.
 */
export const MEMORY_CATEGORIES = ['preference', 'workflow', 'presentation', 'terminology', 'digest'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const RECORD_CODE = new RegExp(ENTITY_ID_PATTERN.source.replace(/^\^|\$$/g, ''), 'i');
const MONEY = /\$\s?\d|\b\d+(,\d{3})*(\.\d{2})?\s?(dollars|usd|cents)\b/i;
const POLICY_TALK =
  /\b(always|never|usually|generally|safe to|approve|approved|approves|release|released|releases|cleared|clears|fee applies|is fine|is ok|is okay|can be)\b/i;

export type MemoryVerdict =
  | { ok: true; category: MemoryCategory }
  | { ok: false; code: 'MEMORY_KEY' | 'MEMORY_NOT_A_PREFERENCE'; reason: string };

/** A memory key is `category.name`; a value is a preference, not a record, an amount or a rule. */
export function screenMemory(key: string, value: string): MemoryVerdict {
  const [category, ...rest] = key.split('.');
  if (!category || rest.length === 0 || !(MEMORY_CATEGORIES as readonly string[]).includes(category)) {
    return {
      ok: false,
      code: 'MEMORY_KEY',
      reason: `memory keys are category.name, with a category of ${MEMORY_CATEGORIES.join(', ')}`,
    };
  }
  if (RECORD_CODE.test(value))
    return {
      ok: false,
      code: 'MEMORY_NOT_A_PREFERENCE',
      reason: 'a memory may not name a record; facts about a horse, an embryo or an invoice belong on the record',
    };
  if (MONEY.test(value))
    return {
      ok: false,
      code: 'MEMORY_NOT_A_PREFERENCE',
      reason: 'a memory may not hold an amount; fees and balances come from the ledger',
    };
  if (POLICY_TALK.test(value))
    return {
      ok: false,
      code: 'MEMORY_NOT_A_PREFERENCE',
      reason:
        'a memory may not hold a rule of thumb about what is safe, approved or cleared; rules live in code and a person decides each time',
    };
  return { ok: true, category: category as MemoryCategory };
}

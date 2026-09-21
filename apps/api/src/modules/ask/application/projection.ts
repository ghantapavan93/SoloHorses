import { createHash } from 'node:crypto';
import { extractEntityIds } from '@daysheet/domain';

/**
 * What the assistant reasons over is a projection, not the schema. Each tool builds a
 * document that contains exactly the fields the model may see — no phone numbers, no
 * e-mail addresses, no payment-method details, no columns that happen to exist — and
 * stamps it with:
 *
 *   sourceIds       every record code in the document; the only codes an answer may cite
 *   contextVersion  a hash of the document; if the underlying state changes, so does this,
 *                   which is what lets an answer be served from cache only against the
 *                   same state it was produced from
 */
export interface ProjectionMeta {
  entity: string;
  id: string;
  sourceIds: string[];
  contextVersion: string;
  /** Names of fields deliberately withheld from the model for this entity. */
  withheld: string[];
}

export type Projected<T> = T & { _projection: ProjectionMeta };

export function project<T extends Record<string, unknown>>(
  entity: string,
  id: string,
  doc: T,
  withheld: string[] = [],
): Projected<T> {
  const json = JSON.stringify(doc);
  return {
    ...doc,
    _projection: { entity, id, sourceIds: extractEntityIds(json), contextVersion: hash(json), withheld },
  };
}

/** One version for a whole answer: the tool results it saw, in order. */
export function combineVersions(versions: string[]): string {
  return hash(versions.join('|'));
}

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

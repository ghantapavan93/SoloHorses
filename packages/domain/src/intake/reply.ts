import type { IntakeParse } from './parse';

/**
 * The reply is the confirmation. Until it goes out, nothing is confirmed — so the reply must
 * carry everything the sender needs to check our reading of their text: the IDs we assigned,
 * the cross as we understood it, the count, and when we expect it.
 */

export interface ReplyContext {
  embryoIds: string[];
  parse: IntakeParse;
  farmName?: string;
}

const SMS_LIMIT = 320; // two segments; anything longer becomes a phone call anyway

export function formatIntakeConfirmation(ctx: ReplyContext): string {
  const { parse } = ctx;
  const parts: string[] = [];
  parts.push(`Received ${ctx.embryoIds.join(', ')}`);
  const cross = parse.sireName && parse.damName ? `${parse.sireName} x ${parse.damName}` : null;
  if (cross) parts.push(cross);
  const countLabel =
    parse.embryoCount !== null
      ? `${parse.embryoCount} ${parse.kind === 'UNKNOWN' ? '' : parse.kind + ' '}embryo${parse.embryoCount === 1 ? '' : 's'}`
      : null;
  if (countLabel) parts.push(countLabel.replace(/\s+/g, ' '));
  if (parse.expectedArrival) parts.push(`expected ${parse.expectedArrival}`);
  if (parse.storage && parse.kind === 'THAWED') parts.push(`storage: ${parse.storage}`);
  const body = `${parts.join(' · ')}. Reply with corrections. Reply STOP to opt out.`;
  return body.length <= SMS_LIMIT ? body : `${body.slice(0, SMS_LIMIT - 1)}…`;
}

export function formatIntakeQuestion(parse: IntakeParse): string {
  const labels: Record<string, string> = {
    sireName: 'sire',
    damName: 'dam',
    eventDate: parse.kind === 'ICSI' ? 'ICSI date' : 'ovulation/flush date',
    embryoCount: 'number of embryos',
    storage: 'where the embryo is stored',
    expectedArrival: 'expected arrival',
  };
  const asks = parse.missing.map((m) => labels[m] ?? m);
  return `Got your text. Before we can enter it we need: ${asks.join(', ')}. Not confirmed until we reply with embryo IDs.`;
}

export const HELP_REPLY =
  'Recip Farm intake line. Text each cross as: Sire x Dam, ICSI or ovulation date, number of embryos, sending vet, arrival. Not confirmed until we reply with IDs. Reply STOP to opt out.';

export const STOP_REPLY = 'You are opted out of Recip Farm texts. Call the office to re-enable.';

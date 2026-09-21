import type { ExceptionKind } from '@daysheet/db';

/**
 * Every exception carries two more things than its title: the system state, as the tables
 * hold it, and what that means in the words of the person who has to act. The first is for
 * the engineer; the second is for the founder, the vet and the office. Both are templates
 * over the detail the detector wrote — nothing here is generated.
 */
export interface Explanation {
  systemState: { key: string; value: string }[];
  meaning: string;
}

function text(detail: Record<string, unknown> | null | undefined, key: string, fallback = '—'): string {
  const value = detail?.[key];
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

export function explain(
  kind: ExceptionKind,
  detail: Record<string, unknown> | null | undefined,
  entityId: string | null,
): Explanation {
  const d = detail ?? {};
  switch (kind) {
    case 'PAPERS_HELD':
      return {
        systemState: [
          { key: 'payment.method', value: text(d, 'method').toLowerCase() },
          { key: 'payment.status', value: text(d, 'paymentStatus').toLowerCase() },
          { key: 'funds', value: text(d, 'funds').toLowerCase() },
          { key: 'document.status', value: text(d, 'documentStatus').toLowerCase() },
          { key: 'settlement.due', value: text(d, 'dueOn') },
          { key: 'rule', value: text(d, 'policy') },
        ],
        meaning:
          text(d, 'code') === 'SETTLEMENT_RETURNED'
            ? 'The bank returned the debit after it looked settled. The papers are held again, and the buyer owes the settlement over. A person decides how to collect; nothing here charges anyone.'
            : text(d, 'method') === 'ACH'
              ? 'The buyer has started the payment, but the bank has not finished moving the money yet. The registration papers stay held until the funds are confirmed cleared — and even then a person sends them.'
              : 'The lot is not paid in full yet. The registration papers stay held until the money clears, and a person sends them.',
      };
    case 'PAPERS_RELEASED_FUNDS_RETURNED':
      return {
        systemState: [
          { key: 'document.status', value: 'released' },
          { key: 'document.released_by', value: text(d, 'releasedBy') },
          { key: 'payment.status', value: 'returned' },
          { key: 'payment.reason', value: text(d, 'reason') },
          { key: 'funds', value: 'not cleared' },
        ],
        meaning:
          'The certificate already went to the buyer, and then the bank pulled the money back. Software cannot recall a document. Billing calls the buyer and the association today; this row stays open until a person writes down what was done.',
      };
    case 'SETTLEMENT_CONFLICT':
      return {
        systemState: [
          { key: 'ledger.payment', value: text(d, 'ledgerStatus').toLowerCase() },
          { key: 'stripe.latest_event', value: text(d, 'providerLatest') },
          { key: 'document.status', value: text(d, 'documentStatus').toLowerCase() },
        ],
        meaning:
          'Our ledger and the payment provider do not agree about this money. Nothing here picks a winner: billing looks at both, decides which is right, and writes down why.',
      };
    case 'RETURN_ASSESSMENT_MISSING':
      return {
        systemState: [
          { key: 'lot.kind', value: 'in utero' },
          { key: 'foal.weaned', value: text(d, 'weanedOn') },
          { key: 'recip.returned', value: text(d, 'returnedOn') },
          { key: 'vet.return_assessment', value: 'missing' },
          { key: 'fee.decision', value: 'blocked' },
        ],
        meaning:
          'The mare came back after weaning, but the vet has not recorded whether she is open and in good health. Until that is on record nobody can say whether the sale condition was met; the $6,000 question waits for the vet, then for a person.',
      };
    case 'RETURN_FEE_DECISION':
      return {
        systemState: [
          { key: 'lot.kind', value: 'in utero' },
          { key: 'recip.returned', value: text(d, 'returnedOn', 'not returned') },
          { key: 'vet.return_assessment', value: text(d, 'assessment', 'none') },
          { key: 'rule', value: text(d, 'code') },
          { key: 'fee.decision', value: 'open · nothing charged' },
        ],
        meaning:
          'The sale condition was not met on the record — the mare came back not open, or did not come back by December 1. The condition names a $6,000 recipient purchase fee. Nothing here charges it: billing decides, writes the reason, and issues it by hand if it applies.',
      };
    case 'DEPARTURE_UNCONFIRMED':
      return {
        systemState: [
          { key: 'recip.departure', value: text(d, 'scheduledDepartureOn') },
          { key: 'vet.video_in_foal', value: text(d, 'latestVideoOn', 'none') },
          { key: 'rule', value: text(d, 'code') },
        ],
        meaning:
          'This mare is about to leave with her client. The lease says she is video-confirmed in foal within three days of leaving, and that confirmation is not on record. The vet records it; until then she does not go as a carrying mare.',
      };
    case 'RECIPIENT_MISSING':
      return {
        systemState: [
          { key: 'equine.embryo', value: `${entityId ?? '?'} · ${text(d, 'status').toLowerCase()}` },
          { key: 'equine.expected', value: text(d, 'expectedOn').slice(0, 10) },
          { key: 'recips.planned_recipient', value: 'none' },
        ],
        meaning:
          'An embryo is on its way and no mare is set aside to carry it. Someone at the recip farm picks a set-up mare, or the transfer day arrives with nowhere to put it.',
      };
    case 'RECIPIENT_CONFLICT':
      return {
        systemState: [
          { key: 'recips.planned_recipient', value: text(d, 'recipId') },
          { key: 'recips.carrying', value: text(d, 'carryingEmbryoId') },
          { key: 'rule', value: text(d, 'code') },
        ],
        meaning:
          'Two embryos are written down for the same mare, and she can carry one. The rule refuses the second; a person picks another set-up mare.',
      };
    case 'CLEARANCE_MISSING':
      return {
        systemState: [
          { key: 'recips.planned_recipient', value: text(d, 'recipId') },
          { key: 'vet.clearance', value: text(d, 'code').toLowerCase().replace(/_/g, ' ') },
        ],
        meaning:
          'The mare set aside for this embryo has not been cleared by the vet for a transfer. The transfer is blocked until the vet clears her or another mare is chosen.',
      };
    case 'CHECK_OVERDUE':
      return {
        systemState: [
          { key: 'pregnancy.day', value: text(d, 'gestationDay') },
          { key: 'milestone', value: `day ${text(d, 'milestone')}` },
          { key: 'vet.last_check', value: text(d, 'lastCheck') },
        ],
        meaning:
          'A pregnancy check that should have happened by now is not on record. Either it was done and not written down, or it was missed; the vet team knows which.',
      };
    case 'SHIP_BLOCKED':
      return {
        systemState: [
          { key: 'order.disposition', value: 'hold' },
          { key: 'contract', value: text(d, 'contractId') },
          { key: 'reason', value: text(d, 'reason').toLowerCase().replace(/_/g, ' ') },
        ],
        meaning:
          'A semen order is on a collection day but the contract behind it is not shippable — something is unpaid or unsigned. The stallion office decides whether it ships.',
      };
    case 'INTAKE_UNCONFIRMED':
      return {
        systemState: [
          { key: 'intake.message', value: text(d, 'messageId') },
          { key: 'intake.status', value: 'parsed, not confirmed' },
        ],
        meaning:
          'A text about an embryo was read by the parser but nobody has confirmed it. The sender has not been told yes, and no embryo record exists yet.',
      };
    case 'CONFLICTING_RECORD':
      return {
        systemState: [
          { key: 'vet.check_a', value: text(d, 'checkA') },
          { key: 'vet.check_b', value: text(d, 'checkB') },
        ],
        meaning:
          'Two checks on the same pregnancy disagree. The assistant will report the disagreement rather than choose; the vet decides which record stands.',
      };
    case 'ACCOUNTING_SYNC_FAILED':
      return {
        systemState: [
          { key: 'job', value: text(d, 'jobId') },
          { key: 'attempts', value: text(d, 'attempts') },
          { key: 'last_error', value: text(d, 'error') },
        ],
        meaning:
          'The books refused a document after every retry. Our ledger is unchanged; nothing was double-posted. A person retries or fixes the document.',
      };
    case 'RECONCILIATION_MISMATCH':
      return {
        systemState: [
          { key: 'ours', value: text(d, 'localValue') },
          { key: 'books', value: text(d, 'remoteValue') },
        ],
        meaning:
          'The books and our ledger disagree about this document. A person decides which side is right, and the decision is audited.',
      };
    case 'INTEGRATION_DEGRADED':
      return {
        systemState: [
          { key: 'dependency', value: text(d, 'dependency') },
          { key: 'circuit', value: text(d, 'state') },
        ],
        meaning:
          'An outside system is not answering. Work for it waits in the ledger; everything else keeps running. Nothing is lost.',
      };
    case 'WEBHOOK_FAILED':
      return {
        systemState: [
          { key: 'stripe.event', value: text(d, 'eventId') },
          { key: 'error', value: text(d, 'error') },
        ],
        meaning:
          'A payment event arrived that could not be applied to any record. The money is in Stripe; the ledger did not change. A person matches it or ignores it.',
      };
    case 'JOB_DEAD_LETTERED':
    default:
      return {
        systemState: [
          { key: 'job', value: text(d, 'jobId') },
          { key: 'queue', value: text(d, 'queue') },
          { key: 'attempts', value: text(d, 'attempts') },
        ],
        meaning:
          'A background job gave up after its retries. It is still a row; a person can retry it, and nothing was lost.',
      };
  }
}

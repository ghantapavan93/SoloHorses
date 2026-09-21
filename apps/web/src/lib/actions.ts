'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, newCorrelationId } from './api';
import type { DecisionDiff, DecisionLedger, LabRun, TraceStep, Xray } from './types';

/**
 * Every mutation the UI can make. Each one is a thin call to the API, which owns the rules,
 * followed by revalidation of the screens that show the result. Errors come back as data so
 * forms can render them; nothing here swallows a failure.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T; correlationId: string }
  | { ok: false; error: string; status?: number; correlationId: string | null };

async function run<T>(fn: (correlationId: string) => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  return runAs(fn, paths);
}

/** `allowReviewer` lets the public front door act as the demo reviewer when nobody is signed in. */
async function runAs<T>(fn: (correlationId: string) => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  // One id per action: the API adopts it, and a failure toast can show it for support.
  const correlationId = newCorrelationId();
  try {
    const data = await fn(correlationId);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data, correlationId };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        ok: false,
        error: error.message,
        status: error.status,
        correlationId: error.correlationId ?? correlationId,
      };
    return { ok: false, error: (error as Error).message, correlationId };
  }
}

// ───────────────────────────── checks ─────────────────────────────

/** The vet's ultrasound, recorded. On the public story the demo reviewer records it; the audit row names the actor. */
export async function recordCheckAction(
  transferId: string,
  embryoId: string,
  input: { result: string; dayNumber?: number; notes?: string | null },
  allowReviewer = false,
) {
  return run(
    (correlationId) =>
      apiFetch<{ checkId: string; invoices: string[]; notes: string[]; embryoStatus: string }>(
        `/transfers/${transferId}/checks`,
        { method: 'POST', json: input, correlationId, allowReviewer },
      ),
    ['/today', `/embryos/${embryoId}`, '/money', '/story', '/', '/operations'],
  );
}

// ───────────────────────────── payments ─────────────────────────────

export async function simulatePaymentAction(
  invoiceId: string,
  outcome: 'succeeded' | 'processing' | 'failed',
  method: 'CARD' | 'ACH',
  revalidate: string[],
) {
  return run(
    (correlationId) =>
      apiFetch<{ eventId: string; duplicate: boolean; mode: string }>(`/payments/simulate`, {
        method: 'POST',
        json: { invoiceId, outcome, method },
        correlationId,
      }),
    ['/today', '/money', '/contracts', ...revalidate],
  );
}

export async function replayEventAction(eventId: string, revalidate: string[]) {
  return run(
    (correlationId) =>
      apiFetch<{ duplicate: boolean; eventId: string }>(`/payments/replay/${encodeURIComponent(eventId)}`, {
        method: 'POST',
        correlationId,
      }),
    ['/money', ...revalidate],
  );
}

export async function hostedLinkAction(invoiceId: string) {
  return run(
    (correlationId) =>
      apiFetch<{ simulated: boolean; hostedInvoiceUrl: string | null }>(`/invoices/${invoiceId}/hosted-link`, {
        method: 'POST',
        correlationId,
      }),
    [],
  );
}

export async function manualPaymentAction(
  invoiceId: string,
  method: 'CHECK' | 'CASH',
  amountCents: number,
  note: string | null,
  revalidate: string[],
) {
  return run(
    (correlationId) =>
      apiFetch<{ paymentId: string }>(`/invoices/${invoiceId}/manual-payment`, {
        method: 'POST',
        json: { method, amountCents, note },
        correlationId,
      }),
    ['/today', '/money', ...revalidate],
  );
}

export async function refundAction(paymentId: string, amountCents: number, reason: string, revalidate: string[]) {
  return run(
    (correlationId) =>
      apiFetch<{ requested: boolean; simulated: boolean }>(`/payments/${paymentId}/refund`, {
        method: 'POST',
        json: { amountCents, reason },
        correlationId,
      }),
    ['/money', ...revalidate],
  );
}

// ───────────────────────────── accounting ─────────────────────────────

export async function resolveDiscrepancyAction(id: string, resolution: string, note: string | null) {
  return run(
    () => apiFetch(`/money/discrepancies/${id}/resolve`, { method: 'POST', json: { resolution, note } }),
    ['/money'],
  );
}

export async function retryMappingAction(id: string) {
  return run(() => apiFetch(`/money/mappings/${id}/retry`, { method: 'POST' }), ['/money']);
}

export async function reconcileNowAction() {
  return run(
    (correlationId) => apiFetch<{ findings: number }>(`/money/reconcile`, { method: 'POST', correlationId }),
    ['/money'],
  );
}

export async function tamperBooksAction(
  entityType: 'INVOICE' | 'PAYMENT',
  docNumber: string,
  patch: { totalCents?: number; unlink?: boolean },
) {
  return run(
    () => apiFetch(`/money/simulator/tamper`, { method: 'POST', json: { entityType, docNumber, ...patch } }),
    ['/money'],
  );
}

export async function armFaultsAction(spec: string) {
  return run(() => apiFetch(`/money/simulator/faults`, { method: 'POST', json: { spec } }), ['/money']);
}

// ───────────────────────────── intake & messaging ─────────────────────────────

export async function simulateInboundAction(from: string, body: string) {
  return run(
    (correlationId) =>
      apiFetch<{ messageId: string; classification: string }>(`/intake/simulate-inbound`, {
        method: 'POST',
        json: { from, body },
        correlationId,
      }),
    ['/intake', '/today'],
  );
}

export async function confirmIntakeAction(messageId: string, corrections: Record<string, unknown>) {
  return run(
    (correlationId) =>
      apiFetch<{ embryoIds: string[]; reply: string }>(`/intake/${messageId}/confirm`, {
        method: 'POST',
        json: corrections,
        correlationId,
      }),
    ['/intake', '/today'],
  );
}

export async function askMissingAction(messageId: string) {
  return run(
    (correlationId) =>
      apiFetch<{ reply: string }>(`/intake/${messageId}/ask-missing`, { method: 'POST', correlationId }),
    ['/intake'],
  );
}

export async function rejectIntakeAction(messageId: string, reason: string) {
  return run(() => apiFetch(`/intake/${messageId}/reject`, { method: 'POST', json: { reason } }), ['/intake']);
}

export async function sendDigestAction(customerId: string, channels: ('SMS' | 'EMAIL')[]) {
  return run(
    (correlationId) =>
      apiFetch<{ queued: string[]; skipped: string[] }>(`/digests/${customerId}/send`, {
        method: 'POST',
        json: { channels },
        correlationId,
      }),
    ['/intake', `/customers/${customerId}`],
  );
}

// ───────────────────────────── ask: memory, feedback, requests ─────────────────────────────

export async function rememberAction(scope: 'USER' | 'ORG', key: string, value: string) {
  return run(() => apiFetch(`/ask/memory`, { method: 'POST', json: { scope, key, value } }), ['/memory']);
}

export async function forgetAction(id: string) {
  return run(() => apiFetch(`/ask/memory/${id}`, { method: 'DELETE' }), ['/memory']);
}

/** The x-ray a signal opens on, for a peek beside the conversation: the same projection the signal's page draws. */
export async function xrayForSignalAction(signalId: string) {
  return run(
    (correlationId) =>
      apiFetch<Xray>(`/operations/signals/${encodeURIComponent(signalId)}/xray`, {
        correlationId,
        allowReviewer: true,
      }),
    [],
  );
}

/** One mare's x-ray, read again after something changed on her: the same projection her record page draws, focused on one signal when asked. */
export async function xrayForRecipAction(recipId: string, focus: string | null = null) {
  const query = focus ? `?focus=${encodeURIComponent(focus)}` : '';
  return run(
    (correlationId) =>
      apiFetch<Xray>(`/operations/xray/${encodeURIComponent(recipId)}${query}`, { correlationId, allowReviewer: true }),
    [],
  );
}

/** A decision as a diff and as a ledger, for the front door to follow one it just watched being prepared. */
export async function decisionDiffAction(id: string) {
  return run(
    (correlationId) =>
      apiFetch<DecisionDiff>(`/proposals/${encodeURIComponent(id)}/diff`, { correlationId, allowReviewer: true }),
    [],
  );
}

export async function decisionLedgerAction(id: string) {
  return run(
    (correlationId) =>
      apiFetch<DecisionLedger>(`/proposals/${encodeURIComponent(id)}/ledger`, { correlationId, allowReviewer: true }),
    [],
  );
}

export async function feedbackAction(messageId: string, rating: 'UP' | 'DOWN', correction: string | null) {
  return run(
    (correlationId) =>
      apiFetch<{ id: string }>(`/ask/messages/${messageId}/feedback`, {
        method: 'POST',
        json: { rating, correction },
        correlationId,
        allowReviewer: true,
      }),
    [],
  );
}

export async function promoteFeedbackAction(
  feedbackId: string,
  category: string,
  expected: Record<string, unknown>,
  alsoRemember: { scope: 'USER' | 'ORG'; key: string; value: string } | null,
) {
  return run(
    (correlationId) =>
      apiFetch<{ evalCaseId: string }>(`/ask/feedback/${feedbackId}/promote`, {
        method: 'POST',
        json: { category, expected, alsoRemember },
        correlationId,
      }),
    ['/evals', '/memory'],
  );
}

export async function closeRequestAction(id: string, note: string | null) {
  return run(
    (correlationId) =>
      apiFetch<{ id: string; status: string }>(`/requests/${id}/close`, {
        method: 'POST',
        json: { note },
        correlationId,
      }),
    ['/requests', '/operations', '/decisions'],
  );
}

export async function createRequestAction(subject: string, body: string, evidenceIds: string[]) {
  return run(
    (correlationId) =>
      apiFetch<{ id: string }>(`/requests`, {
        method: 'POST',
        json: { subject, body, evidenceIds },
        correlationId,
        allowReviewer: true,
      }),
    ['/requests', '/operations'],
  );
}

// ───────────────────────────── evals ─────────────────────────────

/** Starts a run; the API answers at once and the run fills in on the Evals page. */
export async function runEvalsAction(categories?: string[]) {
  return run(
    (correlationId) =>
      apiFetch<{ id: string; total: number; model: string }>(`/evals/run`, {
        method: 'POST',
        json: { categories },
        correlationId,
      }),
    ['/evals'],
  );
}

export async function toggleEvalCaseAction(id: string, enabled: boolean) {
  return run(() => apiFetch(`/evals/cases/${id}/toggle`, { method: 'POST', json: { enabled } }), ['/evals']);
}

// ───────────────────────────── operations ─────────────────────────────

export async function acknowledgeExceptionAction(id: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean }>(`/operations/exceptions/${id}/acknowledge`, { method: 'POST', correlationId }),
    ['/operations'],
  );
}

export async function resolveExceptionAction(id: string, note: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean }>(`/operations/exceptions/${id}/resolve`, {
        method: 'POST',
        json: { note },
        correlationId,
      }),
    ['/operations', '/today'],
  );
}

export async function ignoreExceptionAction(id: string, note: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean }>(`/operations/exceptions/${id}/ignore`, {
        method: 'POST',
        json: { note },
        correlationId,
      }),
    ['/operations'],
  );
}

export async function retryExceptionAction(id: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean; reason?: string }>(`/operations/exceptions/${id}/retry`, {
        method: 'POST',
        correlationId,
      }),
    ['/operations', '/money'],
  );
}

export async function detectExceptionsAction() {
  return run(
    (correlationId) =>
      apiFetch<{ raised?: number; resolved?: number; queued?: boolean }>(`/operations/detect`, {
        method: 'POST',
        correlationId,
      }),
    ['/operations'],
  );
}

export async function traceAction(correlationIdToTrace: string) {
  return run(
    (correlationId) =>
      apiFetch<{ correlationId: string; steps: TraceStep[] }>(
        `/platform/trace/${encodeURIComponent(correlationIdToTrace)}`,
        { correlationId },
      ),
    [],
  );
}

// ───────────────────────────── reliability lab ─────────────────────────────

export async function runScenarioAction(scenario: string) {
  return run(
    (correlationId) => apiFetch<LabRun>(`/lab/run/${scenario}`, { method: 'POST', correlationId }),
    ['/lab', '/operations', '/money'],
  );
}

export async function restoreAccountingAction() {
  return run(
    (correlationId) =>
      apiFetch<{ restored: boolean; breaker: string }>(`/lab/restore-accounting`, { method: 'POST', correlationId }),
    ['/lab'],
  );
}

export async function resumeWorkersAction() {
  return run(
    (correlationId) => apiFetch<{ resumed: boolean }>(`/lab/resume-workers`, { method: 'POST', correlationId }),
    ['/lab', '/money'],
  );
}

export async function resetBreakerAction(dependency: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean; state: string }>(`/platform/breakers/${dependency}/reset`, {
        method: 'POST',
        correlationId,
      }),
    ['/lab', '/architecture'],
  );
}

// ───────────────────────────── proposals ─────────────────────────────

export async function approveProposalAction(id: string, edits: { body?: string; note?: string } = {}) {
  return run(
    (correlationId) =>
      apiFetch<{
        status: 'APPROVED' | 'DECLINED' | 'STALE';
        code?: 'PROPOSAL_STALE' | 'REFUSED_BY_RULE';
        reason?: string;
        result?: Record<string, unknown>;
      }>(`/proposals/${id}/approve`, { method: 'POST', json: edits, correlationId, allowReviewer: true }),
    ['/story', '/operations', '/today', '/decisions'],
  );
}

export async function declineProposalAction(id: string, note: string) {
  return run(
    (correlationId) =>
      apiFetch<{ status: 'DECLINED' }>(`/proposals/${id}/decline`, {
        method: 'POST',
        json: { note },
        correlationId,
        allowReviewer: true,
      }),
    ['/story', '/operations'],
  );
}

// ───────────────────────────── the front door's two controls ─────────────────────────────

export async function storyRedeliverWebhookAction() {
  return run(
    (correlationId) =>
      apiFetch<{
        eventId: string;
        deliveries: number;
        duplicatesRejected: number;
        processed: number;
        paymentsForInvoice: number;
        mode: string;
      }>(`/lab/story/redeliver-webhook`, { method: 'POST', correlationId, allowReviewer: true }),
    ['/story', '/money'],
  );
}

export async function storyBooksAction(down: boolean) {
  return run(
    (correlationId) =>
      apiFetch<{ down: boolean; breaker: string }>(`/lab/story/books`, {
        method: 'POST',
        json: { down },
        correlationId,
        allowReviewer: true,
      }),
    ['/story', '/money', '/operations'],
  );
}

// ───────────────────────────── clearances ─────────────────────────────

/** The vet's word on a mare. On the public pages the demo reviewer records it; the audit row names the actor. */
export async function recordClearanceAction(
  horseId: string,
  kind: string,
  result: string,
  note: string | null,
  allowReviewer = false,
) {
  return run(
    (correlationId) =>
      apiFetch<{
        clearanceId: string;
        horseId: string;
        kind: string;
        result: string;
        performedOn: string;
        expiresOn: string | null;
      }>(`/horses/${encodeURIComponent(horseId)}/clearances`, {
        method: 'POST',
        json: { kind, result, note },
        correlationId,
        allowReviewer,
      }),
    ['/story', '/settlement', '/operations', '/today', `/horses/${horseId}`],
  );
}

// ───────────────────────────── the sale's settlement (front door) ─────────────────────────────

const SETTLEMENT_PATHS = ['/settlement', '/', '/operations', '/money'];

/** Simulated: the bank finishes the ACH debit. Same inbox, same rule, same consumer as production. */
/** The controls name the lot on screen, so two people (or two test runs) on the page cannot settle each other's sale. */
export async function settlementSettleAchAction(lotId?: string) {
  return run(
    (correlationId) =>
      apiFetch<{ lotId: string; eventId: string; paymentId: string; mode: string }>(`/lab/settlement/settle-ach`, {
        method: 'POST',
        json: { lotId },
        correlationId,
        allowReviewer: true,
      }),
    SETTLEMENT_PATHS,
  );
}

/** Simulated: a late, contradicting Stripe delivery. The ledger holds; the detector raises the disagreement. */
export async function settlementConflictAction(lotId?: string) {
  return run(
    (correlationId) =>
      apiFetch<{ lotId: string; eventId: string; paymentId: string }>(`/lab/settlement/conflict`, {
        method: 'POST',
        json: { lotId },
        correlationId,
        allowReviewer: true,
      }),
    SETTLEMENT_PATHS,
  );
}

/** The honesty page's "Run evals": the same run the Evals page starts; a signed-in admin only. */
export async function buildRunEvalsAction() {
  return run(
    (correlationId) =>
      apiFetch<{ id: string; total: number; model: string }>(`/evals/run`, { method: 'POST', json: {}, correlationId }),
    ['/build', '/evals'],
  );
}

/** Stripe delivers the settlement event again: the inbox counts it, the ledger does not move. */
export async function settlementReplayAction(eventId: string) {
  return run(
    (correlationId) =>
      apiFetch<{ duplicate: boolean; eventId: string; deliveries: number }>(
        `/payments/replay/${encodeURIComponent(eventId)}`,
        { method: 'POST', correlationId, allowReviewer: true },
      ),
    SETTLEMENT_PATHS,
  );
}

/** The bank returned the debit; billing records it. A person's action: the ledger moves one way, or 409 explains why not. */
export async function recordReturnAction(paymentId: string, reason: string) {
  return run(
    (correlationId) =>
      apiFetch<{ paymentId: string; status: 'RETURNED'; invoiceId: string | null }>(
        `/payments/${encodeURIComponent(paymentId)}/return`,
        { method: 'POST', json: { reason }, correlationId, allowReviewer: true },
      ),
    SETTLEMENT_PATHS,
  );
}

/** A fresh synthetic lot at Monday-morning state, so the settlement can be run again. */
export async function settlementNewAction() {
  return run(
    (correlationId) =>
      apiFetch<{ lotId: string; invoiceId: string; paymentId: string; documentId: string }>(`/lab/settlement/new`, {
        method: 'POST',
        correlationId,
        allowReviewer: true,
      }),
    SETTLEMENT_PATHS,
  );
}

/** A person's click. The rule is asked again on the server; billing or an admin only. */
export async function releaseDocumentAction(documentId: string, note: string | null) {
  return run(
    (correlationId) =>
      apiFetch<{ documentId: string; status: 'RELEASED'; releasedAt: string }>(
        `/documents/${encodeURIComponent(documentId)}/release`,
        { method: 'POST', json: { note }, correlationId, allowReviewer: true },
      ),
    SETTLEMENT_PATHS,
  );
}

export async function storyResolveExceptionAction(id: string, note: string) {
  return run(
    (correlationId) =>
      apiFetch<{ ok: boolean }>(`/operations/exceptions/${id}/resolve`, {
        method: 'POST',
        json: { note },
        correlationId,
        allowReviewer: true,
      }),
    ['/story', '/operations'],
  );
}

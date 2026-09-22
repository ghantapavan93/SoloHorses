/**
 * Shapes of what the API returns, as the UI uses them. Dates arrive as ISO strings.
 * Kept deliberately narrow: only the fields a screen reads.
 */

export type Role = 'ADMIN' | 'STALLION_OFFICE' | 'RECIPS' | 'VET' | 'BILLING' | 'CUSTOMER';

export interface Health {
  ok: boolean;
  today: string;
  demoClock: boolean;
  integrations: Record<'stripe' | 'qbo' | 'twilio' | 'resend' | 'anthropic', 'live' | 'simulated'>;
  /** When the world was seeded; a session from an earlier world is stale. */
  seededAt?: string | null;
}

export interface CollectionRow {
  orderId: string;
  contractId: string;
  customer: string;
  customerId: string;
  mare: string;
  mareId: string;
  stallion: string;
  stallionId: string;
  shipTo: string;
  container: string;
  placedAt: string;
  status: string;
  disposition: 'SHIP' | 'HOLD' | 'CANCELLED';
  holds: string[];
  balanceCents: number | null;
}

export interface TransferRow {
  embryoId: string;
  customer: string;
  customerId: string;
  cross: string;
  status: string;
  expectedOn: string | null;
  arrivedAt: string | null;
  source: string;
  storage: string | null;
}

export interface CheckDueRow {
  transferId: string;
  embryoId: string;
  recipId: string;
  recipNumber: number | null;
  customer: string;
  customerId: string;
  gestationDay: number;
  lastCheck: { day: number; result: string; on: string } | null;
  nextMilestone: number | null;
  crossesToday: 'HEARTBEAT' | 'ICSI_FEE_WINDOW' | 'PURCHASE_CONFIRM' | null;
}

export interface LabDueRow {
  labBatchId: string;
  aspirationId: string;
  donor: string;
  donorId: string;
  shippedOn: string;
  expectedResultOn: string;
  status: string;
  daysOut: number;
}

export interface Daysheet {
  today: string;
  isCollectionDay: boolean;
  isAspirationDay: boolean;
  collectionDay: string | null;
  demoClock: boolean;
  collection: CollectionRow[];
  transfers: TransferRow[];
  checksDue: CheckDueRow[];
  labDue: LabDueRow[];
  counters: {
    south: { label: string; stallions: number; ordersOnHold: number; labBatchesOut: number };
    north: { label: string; donorsOnSite: number };
    recipFarm: { label: string; setUp: number; carrying: number; embryosExpected: number };
  };
}

export interface TimelineEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  actor?: string | null;
  amountCents?: number;
  links: string[];
}

export interface HorseLite {
  id: string;
  name: string;
  kind: string;
  sex?: string;
  recipNumber?: number | null;
  recipStatus?: string | null;
  site?: string;
}

export interface CustomerLite {
  id: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  smsOptedOut?: boolean;
}

export interface Invoice {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  description: string;
  issuedOn: string;
  dueOn: string;
  customerId: string;
  contractId?: string | null;
  embryoId?: string | null;
  triggeredByCheckId?: string | null;
  stripeInvoiceId?: string | null;
  payments?: Payment[];
}

export interface Payment {
  id: string;
  invoiceId: string | null;
  customerId: string;
  method: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  stripePaymentIntentId: string | null;
  failureReason: string | null;
  receivedAt: string;
  invoice?: Invoice | null;
  customer?: CustomerLite;
  refunds?: { id: string; amountCents: number; reason: string | null; createdAt: string }[];
}

export interface Check {
  id: string;
  dayNumber: number;
  performedOn: string;
  result: string;
  notes: string | null;
  recordedBy?: { name: string };
  triggeredInvoices?: Invoice[];
}

export interface Transfer {
  id: string;
  embryoId: string;
  recipientId: string;
  performedOn: string;
  recipient: HorseLite;
  checks: Check[];
}

export interface Embryo {
  id: string;
  source: string;
  status: string;
  customerId: string;
  customer: CustomerLite;
  contract?: { id: string; type: string; status: string; stallion: HorseLite } | null;
  sire?: HorseLite | null;
  dam?: HorseLite | null;
  sireName?: string | null;
  damName?: string | null;
  storageTank?: string | null;
  storageSlot?: string | null;
  expectedOn?: string | null;
  arrivedAt?: string | null;
  sendingVet?: string | null;
  aspiration?: {
    id: string;
    performedOn: string;
    oocyteCount: number;
    donorMare: HorseLite;
    labBatch?: { id: string; status: string; embryoCount: number | null; expectedResultOn: string } | null;
  } | null;
  transfers: Transfer[];
  invoices: Invoice[];
  updatedAt?: string;
}

export interface EmbryoPage {
  embryo: Embryo;
  timeline: TimelineEvent[];
}

export interface EmbryoListItem {
  id: string;
  status: string;
  source: string;
  customer: CustomerLite;
  sire?: HorseLite | null;
  dam?: HorseLite | null;
  sireName?: string | null;
  damName?: string | null;
  transfers: { id: string; recipient: HorseLite; performedOn: string; checks: Check[] }[];
  updatedAt: string;
}

export interface SemenOrder {
  id: string;
  status: string;
  requestedFor: string;
  placedAt: string;
  shipToVet: string;
  shipToCity: string;
  container: string;
}

export interface Contract {
  id: string;
  season: number;
  type: string;
  status: string;
  customerId: string;
  customer: CustomerLite;
  stallion: HorseLite;
  mare: HorseLite | null;
  studFeeCents: number;
  chuteFeeCents: number;
  depositCents: number;
  signedAt: string | null;
  esignEnvelopeId: string | null;
  invoices: Invoice[];
  semenOrders?: SemenOrder[];
  embryos?: { id: string; status: string }[];
  createdAt: string;
}

export interface ContractPage {
  contract: Contract;
  paidCents: number;
  totalCents: number;
  balanceCents: number;
}

export interface Horse extends HorseLite {
  birthYear: number | null;
  owner: CustomerLite | null;
  /** A recip leaving with her client: the day, and the video check the lease wants within three days of it. */
  scheduledDepartureOn?: string | null;
  clearances?: { id: string; kind: string; result: string; performedOn: string; expiresOn: string | null }[];
  transfers: {
    id: string;
    embryoId: string;
    performedOn: string;
    embryo: { status: string; customerId: string };
    checks: Check[];
  }[];
  contractsAsStallion: { id: string; status: string; type: string; customer: CustomerLite; createdAt: string }[];
  embryosAsDam: { id: string; status: string }[];
}

export interface CustomerPage extends CustomerLite {
  notes: string | null;
  horses: HorseLite[];
  contracts: { id: string; status: string; type: string; stallion: HorseLite }[];
  embryos: { id: string; status: string; transfers: { id: string; recipient: HorseLite; checks: Check[] }[] }[];
  invoices: Invoice[];
}

export interface SearchHit {
  id: string;
  type: 'embryo' | 'horse' | 'contract' | 'customer';
  title: string;
  subtitle: string;
}

export interface AuditRow {
  id: string;
  at: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  source: string;
  correlationId: string | null;
}

export interface IntegrationEvent {
  id: string;
  provider: string;
  externalId: string;
  type: string;
  status: string;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  payload?: { simulated?: boolean };
}

export interface AccountingMapping {
  id: string;
  entityType: string;
  entityId: string;
  externalId: string | null;
  syncToken: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  syncAttempts?: SyncAttempt[];
}

export interface SyncAttempt {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  httpStatus: number | null;
  error: string | null;
  remoteRequestId: string | null;
  mapping?: { entityType: string; entityId: string };
}

export interface Discrepancy {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  localValue: Record<string, unknown> | null;
  remoteValue: Record<string, unknown> | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  note: string | null;
  resolvedBy?: { name: string } | null;
  mapping?: AccountingMapping | null;
}

/** One invoice as three systems see it (GET /money/integrity). */
export interface IntegritySide {
  status: string;
  ok: boolean | null;
  note: string | null;
}

export interface InvoiceIntegrityRow {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  issuedOn: string;
  customer: { id: string; name: string };
  embryoId: string | null;
  daysheet: IntegritySide;
  stripe: IntegritySide & { eventId: string | null; deliveries: number; duplicates: number };
  books: IntegritySide & { invoice: string | null; payment: string | null };
  openDiscrepancies: number;
}

export interface IntegrityTimelineRow {
  at: string;
  source: 'daysheet' | 'stripe' | 'quickbooks' | 'queue';
  title: string;
  detail: string | null;
  ok: boolean | null;
  correlationId: string | null;
  ids: string[];
}

export interface MoneySummary {
  provider: { mode: 'live' | 'simulated'; label: string };
  byStatus: { entityType: string; status: string; _count: { _all: number } }[];
  openDiscrepancies: number;
  recentAttempts: SyncAttempt[];
  unsynced: { invoices: number; payments: number };
  jobsMode: 'redis' | 'inline';
}

export interface SimulatorRecord {
  id: string;
  entityType: string;
  externalId: string;
  docNumber: string | null;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface IntakeParse {
  kind: 'ICSI' | 'FLUSH' | 'THAWED' | 'UNKNOWN';
  /** The vet texts twice: on ovulation day and on shipment day (published). */
  stage?: 'OVULATION' | 'SHIPMENT' | 'UNKNOWN';
  /** An ovulation notice on a flush: the day the embryo is expected to be recovered. */
  expectedFlushOn?: string | null;
  sireName: string | null;
  damName: string | null;
  eventDate: string | null;
  embryoCount: number | null;
  storage: string | null;
  sendingVet: string | null;
  expectedArrival: string | null;
  missing: string[];
  confidence: number;
}

export interface Message {
  id: string;
  direction: 'IN' | 'OUT';
  channel: 'SMS' | 'EMAIL';
  status: string;
  fromAddress: string;
  toAddress: string;
  body: string;
  parsed: IntakeParse | null;
  customerId: string | null;
  customer?: CustomerLite | null;
  createdAt: string;
  sentAt: string | null;
  embryos?: { id: string; status: string }[];
}

export interface DigestPreview {
  customer: CustomerLite;
  lines: string[];
  sms: string;
  email: string;
  today: string;
}

export interface AskStatement {
  text: string;
  evidence: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AskAnswer {
  statements: AskStatement[];
  abstentions: { question: string; reason: string; detail?: string }[];
  conflicts: { ids: string[]; description: string; preferredId?: string }[];
  summary: string;
  suggestedRequest?: { subject: string; body: string; evidenceIds: string[] };
}

/** The typed result of an x-ray read, beside the answer: the conclusion, the rules, the boundary, the doors. */
export interface Investigation {
  subject: string;
  conclusion: string;
  stateHash: string;
  asOf: string;
  rulesApplied: { code: string; label: string; verdict: 'ok' | 'blocked'; reason: string | null }[];
  authority: { owner: string; reason: string; next: string; signalId: string } | null;
  availableActions: { kind: 'xray' | 'signal' | 'propose'; label: string; href?: string; question?: string }[];
  block: { signalId: string; kind: string; label: string; entityId: string | null } | null;
  facts: { label: string; value: string; ref: string | null }[];
  openRequests: { id: string; subject: string; since: string }[];
}

/** A door the application owns: the assistant names a record and a part of it; the server resolved the address. */
export interface AskTarget {
  label: string;
  entityType: string;
  entityId: string;
  focus: 'checks' | 'departure' | 'clearances' | null;
  href: string;
  peek: 'xray' | null;
  detail: string | null;
}

/** The answer as a person reads it: one or two sentences, at most three facts, the doors, the acts. Built in code from the tools' results. */
/** The view the workspace opens for an answer: one of the application's own, resolved by the server. */
export interface AskView {
  kind: 'worklist' | 'entity' | 'money-trail' | 'decision';
  label: string;
  href: string;
}

export interface AnswerCard {
  answer: string;
  facts: { label: string; value: string; ref: string | null }[];
  targets: AskTarget[];
  actions: { label: string; action: 'PREPARE_VET_REQUEST' | 'HOLD_RECIPIENT'; question: string }[];
  view: AskView | null;
  stateId: string | null;
  subject: { entityType: string; entityId: string } | null;
}

export type AskEvent =
  | { type: 'tool'; name: string; input: unknown; ok: boolean; idsReturned: string[]; durationMs: number }
  | {
      type: 'answer';
      messageId: string;
      conversationId: string;
      answer: AskAnswer;
      verification: { ok: boolean; rejected: number };
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number; model: string };
      proposals?: ProposalSummary[];
      investigation?: Investigation | null;
      card?: AnswerCard;
    }
  | { type: 'error'; message: string };

export interface ProposalSummary {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  rationale: string;
  evidenceIds: string[];
  /** The catalog's words for the kind: what a yes changes, and what it will never do. */
  spec: { label: string; before: string; after: string; willNot: string[]; riskClass: string; approver: string };
}

/** One line of the gauntlet: what ran, or that it did not. `at` is the artifact's own date when it is a separate pass. */
export interface GauntletLine {
  status: 'PASS' | 'FAILED' | 'NOT RUN';
  detail: string;
  at?: string;
}

/** The API's dependency readout: one row per thing it leans on, from the service that owns it. */
export interface DependencyReadout {
  rows: { name: string; state: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NONE'; note: string; latencyMs?: number | null }[];
  at: string;
}

export interface BuildHealth {
  verify: {
    startedAt: string;
    finishedAt: string;
    commit: string | null;
    dirty?: boolean;
    ok: boolean;
    gates: Record<string, { ok: boolean; ms: number }>;
    suites: Record<string, { ok: boolean; passed: number; total: number; ms: number }>;
    gauntlet?: Partial<Record<'architecture' | 'properties' | 'mutation' | 'fuzz' | 'accessibility', GauntletLine>>;
  } | null;
  /** The commit the API is running; null when the process cannot tell. */
  head: string | null;
  lastEvent: { type: string; aggregateId: string; at: string; correlationId: string | null } | null;
  lastTrace: { action: string; entityId: string; at: string; correlationId: string | null } | null;
  lastStripeEvent: { eventId: string; type: string; status: string; deliveries: number; at: string } | null;
  lastEval: {
    id: string;
    passed: number;
    total: number;
    model: string;
    at: string;
    adversarial?: { passed: number; total: number } | null;
  } | null;
}

export interface AskStatus {
  live: boolean;
  /** Who answers: the Anthropic API, a local Ollama model, or the deterministic offline answerer. */
  provider?: 'anthropic' | 'ollama' | 'openai' | 'offline';
  model: string;
  spend: { ok: boolean; spentCents: number; capCents: number };
  review?: { graph: string; durable: boolean };
}

/** The assistant's authority boundary as data (`GET /ask/authority`). */
export interface AskAuthority {
  tools: { name: string; authority: 'read_only' | 'requires_approval'; description: string }[];
  refused: { key: string; name: string; reason: string; detail: string }[];
}

/** The last real run, reduced to what the boundary diagram draws (`GET /ask/last-run`). */
export interface AskLastRun {
  question: string;
  at: string;
  model: string | null;
  latencyMs: number | null;
  steps: { seq: number; tool: string; ok: boolean; durationMs: number }[];
  refused: string | null;
  proposal: 'NONE' | 'PROPOSED' | 'APPROVED' | 'DECLINED';
}

export interface Memory {
  id: string;
  scope: 'USER' | 'ORG';
  userId: string | null;
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}

export interface TeamRequest {
  id: string;
  subject: string;
  body: string;
  evidenceIds: string[];
  status: string;
  createdAt: string;
  createdBy?: { name: string; role: string };
}

export interface EvalCase {
  id: string;
  category: string;
  actorRole: string;
  input: string;
  expected: Record<string, unknown>;
  source: string;
  enabled: boolean;
  feedback?: { id: string; correction: string | null } | null;
}

export interface EvalRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  model: string;
  gitSha: string | null;
  total: number;
  passed: number;
  costCents: number | null;
  /** Cases graded so far; a running row fills in. */
  graded?: number;
}

export interface EvalRunDetail extends EvalRun {
  results: {
    id: string;
    passed: boolean;
    score: number | null;
    reason: string | null;
    latencyMs: number | null;
    actual: (AskAnswer & { messageId?: string }) | { error: string } | null;
    case: EvalCase;
  }[];
  byCategory: Record<string, { passed: number; total: number }>;
}

export interface AskConversation {
  id: string;
  createdAt: string;
  messages: {
    id: string;
    role: 'USER' | 'ASSISTANT';
    content: string;
    structured: AskAnswer | null;
    evidenceIds: string[];
    createdAt: string;
    feedback?: { id: string; rating: string; correction: string | null }[];
  }[];
}

// ───────────────────────────── platform: exceptions, jobs, events, lab ─────────────────────────────

export type ExceptionKind =
  | 'JOB_DEAD_LETTERED'
  | 'WEBHOOK_FAILED'
  | 'ACCOUNTING_SYNC_FAILED'
  | 'RECONCILIATION_MISMATCH'
  | 'INTEGRATION_DEGRADED'
  | 'RECIPIENT_MISSING'
  | 'RECIPIENT_CONFLICT'
  | 'CLEARANCE_MISSING'
  | 'CHECK_OVERDUE'
  | 'SHIP_BLOCKED'
  | 'INTAKE_UNCONFIRMED'
  | 'CONFLICTING_RECORD'
  | 'PAPERS_HELD'
  | 'SETTLEMENT_CONFLICT'
  | 'RETURN_ASSESSMENT_MISSING'
  | 'DEPARTURE_UNCONFIRMED'
  | 'RETURN_FEE_DECISION'
  | 'PAPERS_RELEASED_FUNDS_RETURNED'
  | 'DELIVERY_UNKNOWN';

/** Two more things than a title: the system state as the tables hold it, and what it means to the person who acts. Templates, not a model. */
export interface ExceptionExplanation {
  systemState: { key: string; value: string }[];
  meaning: string;
}
export type ExceptionSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type ExceptionStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED';

export interface OperationalException {
  id: string;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  source: string;
  status: ExceptionStatus;
  title: string;
  detail: Record<string, unknown> | null;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
  correlationId: string | null;
  owner: { id: string; name: string } | null;
  resolvedBy: { id: string; name: string } | null;
  resolution: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  explanation?: ExceptionExplanation;
  /** The dollars this row holds up and what they wait on; null where no money is at stake. */
  stake?: { amountCents: number; label: string } | null;
}

export interface ExceptionDefinition {
  label: string;
  severity: ExceptionSeverity;
  source: string;
  actions: ('retry' | 'inspect' | 'resolve' | 'ignore')[];
}

export interface OperationsSummary {
  open: number;
  /** Every dollar an open row holds up, read from the records now; the founder's first number. */
  atStakeCents: number;
  withStake: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface JobRecord {
  id: string;
  queue: string;
  payload: Record<string, unknown>;
  status: 'QUEUED' | 'ACTIVE' | 'RETRYING' | 'COMPLETED' | 'DEAD';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  correlationId: string | null;
  createdAt: string;
  enqueuedAt: string | null;
  startedAt: string | null;
  nextRunAt: string | null;
  finishedAt: string | null;
  deadLetteredAt: string | null;
  updatedAt: string;
}

export interface DomainEventRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  correlationId: string | null;
  causationId: string | null;
  publishedAt: string | null;
}

export interface TraceStep {
  at: string;
  /** When the row's own work ended (a job finished, an event published, an exception resolved); null for an instant or a span still open. */
  until: string | null;
  kind: 'audit' | 'event' | 'job' | 'webhook' | 'integration' | 'exception';
  label: string;
  ref: string;
  /** false when the row records a failure (a dead job, a rejected books call); null when the row has no verdict. */
  ok: boolean | null;
  detail: unknown;
}

export interface BreakerSnapshot {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastError: string | null;
  retryAfterMs: number | null;
  since: string;
  options: { failureThreshold: number; cooldownMs: number };
}

export interface PlatformMetrics {
  metrics: {
    startedAt: string;
    uptimeSeconds: number;
    http: {
      requests: number;
      errors: number;
      byRoute: Record<string, { count: number; errors: number; p50Ms: number; maxMs: number }>;
    };
    jobs: Record<string, number>;
    events: Record<string, number>;
    breakers: Record<string, { state: string; failures: number; since: string }>;
    cache: { hits: number; misses: number; invalidations: number; hitRatio: number };
    rateLimit: { allowed: number; rejected: number };
    integrations: Record<string, { ok: number; fail: number; rateLimited: number }>;
    sse: { subscribers: number };
  };
  jobs: {
    mode: 'redis' | 'inline';
    paused: boolean;
    byStatus: Partial<Record<JobRecord['status'], number>>;
    queues: Record<string, { waiting: number; active: number; delayed: number; failed: number }>;
  };
  outbox: { unpublished: number; oldestUnpublishedAgeMs: number | null };
  breakers: Record<string, BreakerSnapshot>;
  stores: { cache: 'redis' | 'memory'; rateLimit: 'redis' | 'memory'; queue: 'redis' | 'inline' };
  integrations: Health['integrations'];
  today: string;
}

export interface ConsumerRegistration {
  name: string;
  events: string[];
}

export type LabScenario =
  | 'duplicate-webhook'
  | 'ach-settlement'
  | 'qbo-429'
  | 'source-conflict'
  | 'qbo-outage'
  | 'worker-crash'
  | 'stale-cache'
  | 'conflicting-record';

export interface LabScenarioInfo {
  title: string;
  claim: string;
  simulated: string[];
}

export interface LabStatus {
  enabled: boolean;
  simulator: boolean;
  faults: { kind: string; remaining: number | 'until restored'; target?: string }[];
  jobs: PlatformMetrics['jobs'];
  breaker: BreakerSnapshot | null;
  services: { name: string; state: 'HEALTHY' | 'DEGRADED' | 'PAUSED' | 'DOWN'; note: string }[];
  lost: number;
}

export interface LabRun {
  runId: string;
  scenario: LabScenario;
  correlationId: string;
  steps: { at: string; step: string; detail?: Record<string, unknown> }[];
}

export type PlatformSignal =
  | {
      kind: 'job';
      jobId: string;
      queue: string;
      status: 'queued' | 'active' | 'retrying' | 'completed' | 'dead' | 'paused';
      attempt?: number;
      error?: string;
    }
  | {
      kind: 'event';
      eventId: string;
      type: string;
      aggregate: string;
      stage: 'appended' | 'published' | 'consumed' | 'skipped' | 'failed';
      consumer?: string;
      error?: string;
    }
  | {
      kind: 'breaker';
      dependency: string;
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      cooldownMs?: number;
    }
  | { kind: 'cache'; key: string; op: 'hit' | 'miss' | 'set' | 'invalidate' | 'poison' }
  | {
      kind: 'exception';
      exceptionId: string;
      status: 'opened' | 'acknowledged' | 'resolved' | 'ignored' | 'reopened';
      title: string;
      kindName: string;
    }
  | {
      kind: 'integration';
      dependency: string;
      op: string;
      outcome: 'ok' | 'fail' | 'rate-limited';
      attempt?: number;
      httpStatus?: number;
      retryAfterMs?: number;
      jobId?: string;
    }
  | { kind: 'rate-limit'; route: string; scope: string; outcome: 'allowed' | 'rejected' }
  | { kind: 'lab'; runId: string; scenario: string; step: string; detail?: Record<string, unknown> }
  | { kind: 'hello' };

export type PlatformSignalEnvelope = PlatformSignal & { at: string; correlationId: string | null; seq: number };

// ───────────────────────────── the story ─────────────────────────────

export type StorySource =
  'stallion office' | 'lab' | 'recip farm' | 'vet' | 'billing' | 'stripe' | 'quickbooks' | 'text' | 'board';

export interface StoryRow {
  id: string;
  at: string;
  source: StorySource;
  kind: 'event' | 'exception' | 'planned';
  title: string;
  detail?: string;
  amountCents?: number;
  evidenceIds: string[];
  correlationId: string | null;
  exception?: { exceptionId: string; kindName: string; severity: string; status: string; rule: string | null };
}

export interface RuleResult {
  ok: boolean;
  code?: string;
  reason?: string;
  evidenceIds: string[];
}

export interface Story {
  today: string;
  recip: {
    id: string;
    number: number | null;
    status: string | null;
    name: string;
    clearances: { id: string; kind: string; result: string; performedOn: string; expiresOn: string | null }[];
    clearance: RuleResult & { recipId: string };
    departure: { scheduledDepartureOn: string; rule: RuleResult } | null;
    heldFor: { id: string; status: string; expectedOn: string | null }[];
  };
  embryo: {
    id: string;
    status: string;
    source: string;
    cross: string;
    customer: { id: string; name: string };
    contract: { id: string; type: string; status: string; stallion: string } | null;
  };
  pregnancy: {
    transferId: string;
    transferredOn: string;
    gestationDay: number;
    lastCheck: { id: string; day: number; result: string; on: string } | null;
    nextMilestone: number | null;
  };
  money: {
    invoices: {
      id: string;
      kind: string;
      status: string;
      amountCents: number;
      payments: {
        id: string;
        status: string;
        method: string;
        amountCents: number;
        receivedAt: string;
        stripePaymentIntentId: string | null;
      }[];
    }[];
    stripe: {
      eventId: string;
      status: string;
      deliveries: number;
      duplicatesRejected: number;
      paymentsForInvoice: number;
      receivedAt: string;
    } | null;
    books: {
      entityType: string;
      entityId: string;
      status: string;
      externalId: string | null;
      attempts: number;
      lastError: string | null;
      lastSyncedAt: string | null;
      recentAttempts: { at: string; ok: boolean | null; httpStatus: number | null; error: string | null }[];
    }[];
    jobs: {
      id: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      nextRunAt: string | null;
    }[];
  };
  exceptions: {
    id: string;
    kind: string;
    severity: string;
    status: string;
    title: string;
    entityId: string | null;
    correlationId: string | null;
    rule: string | null;
    detail: Record<string, unknown> | null;
  }[];
  freeRecip: { id: string; recipNumber: number | null } | null;
  rows: StoryRow[];
}

// ───────────────────────────── the sale: settlement and papers ─────────────────────────────

export interface SettlementScene {
  today: string;
  lot: {
    id: string;
    kind: 'HORSE' | 'IN_UTERO';
    title: string;
    closedOn: string;
    hammerCents: number;
    buyer: { id: string; name: string };
  };
  invoice: { id: string; status: string; amountCents: number; dueOn: string; dueTime: string } | null;
  payment: {
    id: string;
    method: string;
    status: string;
    amountCents: number;
    stripePaymentIntentId: string | null;
    receivedAt: string;
  } | null;
  document: {
    id: string;
    kind: string;
    status: 'HELD' | 'ELIGIBLE' | 'RELEASED';
    eligibleAt: string | null;
    releasedAt: string | null;
    releasedBy: { id: string; name: string } | null;
  } | null;
  funds: 'CLEARED' | 'PROCESSING' | 'PARTIAL' | 'UNPAID' | 'FAILED' | 'RETURNED';
  rule: { ok: boolean; code?: string; reason?: string; evidenceIds: string[]; policy: string };
  sources: { system: string; state: string; note: string | null }[];
  conflict: { ok: false; code: string; reason: string; evidenceIds: string[] } | null;
  stripe: { eventId: string; type: string; status: string; receivedAt: string }[];
  audit: {
    at: string;
    action: string;
    actor: string | null;
    source: string;
    after: Record<string, unknown> | null;
    correlationId: string | null;
  }[];
  returns: InUteroReturn[];
}

export interface InUteroReturn {
  lot: { id: string; title: string; closedOn: string; hammerCents: number; buyer: { id: string; name: string } };
  recip: {
    id: string;
    number: number | null;
    status: string | null;
    weanedOn: string | null;
    returnedOn: string | null;
  };
  assessment: { id: string; result: string; performedOn: string; note: string | null } | null;
  rule: RuleResult;
  decision: 'WAITING_ON_VET' | 'CONDITION_MET' | 'A_PERSON_DECIDES';
}

// ───────────────────────────── signals: the board as the front door shows it ─────────────────────────────

export type SignalChannel = 'SALE' | 'RECIPIENT' | 'REPRODUCTION' | 'ACCOUNTING' | 'VETERINARY' | 'SYSTEM';

/** A signal's causal map, laid out by the API: records → facts → the rule → the block → the person. */
export interface SignalMap {
  nodes: {
    id: string;
    kind: 'record' | 'fact' | 'rule' | 'gap' | 'decision';
    label: string;
    sublabel?: string;
    recordId?: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  edges: { id: string; from: string; to: string }[];
  blockId: string;
  width: number;
  height: number;
}

export interface Signal {
  id: string;
  kind: ExceptionKind;
  label: string;
  severity: ExceptionSeverity;
  source: string;
  status: ExceptionStatus;
  channel: SignalChannel;
  channelLabel: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  state: { key: string; value: string }[];
  meaning: string;
  stake: { amountCents: number; label: string } | null;
  next: string;
  owner: string;
  ownerName: string | null;
  surface: 'settlement' | 'returns' | 'story' | 'operations' | 'money' | 'intake';
  correlationId: string | null;
  createdAt: string;
  lotId: string | null;
  /** Only on the signal's own address (`GET /operations/signals/:id`). */
  map?: SignalMap;
}

/** One row of the morning brief: an open signal as the brief ranks it. */
export interface BriefRow {
  id: string;
  kind: ExceptionKind;
  label: string;
  title: string;
  severity: ExceptionSeverity;
  source: string;
  entityId: string | null;
  stakeCents: number | null;
  stakeLabel: string | null;
  owner: string;
  next: string;
  surface: Signal['surface'];
  createdAt: string;
}

export interface BriefSnapshotPoint {
  id: string;
  takenAt: string;
  open: number;
  atStakeCents: number;
}

/** `GET /operations/brief`: the board now, against yesterday's snapshot, with the next two days as the rules see them. */
export interface Brief {
  asOf: string;
  barnDate: string;
  demoClock: boolean;
  open: number;
  atStakeCents: number;
  withStake: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
  since: string;
  baseline: BriefSnapshotPoint | null;
  sinceYesterday: {
    raised: BriefRow[];
    resolved: {
      id: string;
      kind: ExceptionKind;
      label: string;
      title: string;
      status: ExceptionStatus;
      resolvedAt: string | null;
      resolution: string | null;
      resolvedBy: string | null;
    }[];
    changes: {
      context: string;
      count: number;
      actions: { action: string; label: string; count: number; last: string }[];
    }[];
  };
  viewer: { role: string; forYou: number };
  needsYou: BriefRow[];
  lookahead: {
    on: string;
    kind:
      'departure' | 'embryo_expected' | 'milestone' | 'lab_result' | 'invoice_due' | 'settlement_due' | 'collection';
    label: string;
    entityId: string | null;
    state: 'ready' | 'blocked' | 'due' | 'watch';
    note: string;
    amountCents?: number;
  }[];
  series: BriefSnapshotPoint[];
}

/** One of the three decisions the front door opens first (`GET /operations/brief/morning`). */
export interface MorningDecision {
  id: string;
  label: string;
  title: string;
  reason: string;
  urgency: 'now' | 'today' | 'watch';
  owner: string;
  ownerName: string | null;
  evidence: number;
  stakeCents: number | null;
  stakeLabel: string | null;
  next: string;
  surface: string;
  entityId: string | null;
  createdAt: string;
}

/** The front door's five seconds; every number the board's own, read now. */
export interface MorningBrief {
  generatedAt: string;
  barnDate: string;
  stateId: string;
  snapshotId: string | null;
  since: string;
  decisions: number;
  needsYou: number;
  changed: { raised: number; resolved: number };
  atStakeCents: number;
  byOwner: Record<string, number>;
  byChannel: Record<string, number>;
  viewer: { role: string };
  top: MorningDecision[];
  /** Three questions worth asking this morning, chosen from the board as it stands. */
  prompts: string[];
}

/** One node of the operational X-ray: a row, a rule, a gap, a signal or the person, with the facts behind it. */
export interface XrayNode {
  id: string;
  type: 'subject' | 'record' | 'fact' | 'rule' | 'gap' | 'signal' | 'money' | 'decision';
  label: string;
  sublabel?: string;
  status: 'ok' | 'blocked' | 'due' | 'watch' | 'neutral';
  source: string;
  recordRef?: string;
  occurredAt?: string;
  facts: { key: string; value: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `GET /operations/xray/:recipId`: every record about one mare, the rules that read them, the block, the person. */
export interface Xray {
  subject: string;
  asOf: string;
  stateHash: string;
  conclusion: string;
  unresolvedBoundary: { owner: string; reason: string; next: string; signalId: string; source: string } | null;
  block: { signalId: string; kind: string; label: string; entityId: string | null } | null;
  rulesApplied: {
    code: string;
    label: string;
    verdict: 'ok' | 'blocked';
    reason: string | null;
    evidenceIds: string[];
  }[];
  blockId: string | null;
  focusId?: string | null;
  nodes: XrayNode[];
  edges: { id: string; from: string; to: string; relation: string }[];
  width: number;
  height: number;
}

/** `GET /proposals`: a proposal with the catalog's words for it. */
export interface DecisionRow {
  id: string;
  kind: string;
  status: 'PROPOSED' | 'APPROVED' | 'DECLINED' | 'STALE';
  payload: Record<string, unknown>;
  rationale: string;
  evidenceIds: string[];
  proposedByUserId: string;
  askMessageId: string | null;
  stateHash: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  decision: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  spec: {
    label: string;
    executes: string;
    approver: string;
    riskClass: string;
    willNot: string[];
    before: string;
    after: string;
  };
}

/** `GET /proposals/:id/ledger`: the whole story of one decision, every line a row with its time. */
/** One fact the decision reads: the rows a yes changes are lit; the rest are what the rule saw. */
export interface DiffLine {
  record: string;
  source: 'reproduction' | 'veterinary' | 'people';
  field: string;
  before: string;
  after: string;
  changes: boolean;
}

/** The decision as a diff (`GET /proposals/:id/diff`), drawn from the reads its fingerprint binds. */
export interface DecisionDiff {
  proposalId: string;
  kind: string;
  status: string;
  label: string;
  subject: string;
  stateHashAtProposal: string | null;
  stateHashNow: string;
  stale: boolean;
  lines: DiffLine[];
  rule: { code: string; label: string; verdict: 'ok' | 'blocked'; reason: string | null } | null;
  executes: string;
  willNot: string[];
  approver: string;
  riskClass: string;
  authority: { resource: string; roles: string[] };
}

export interface DecisionLedger {
  proposal: DecisionRow;
  people: {
    proposedBy: { id: string; name: string; role: string } | null;
    decidedBy: { id: string; name: string; role: string } | null;
  };
  question: string | null;
  investigation: {
    messageId: string;
    at: string;
    model: string | null;
    latencyMs: number | null;
    toolCalls: { name: string; ok: boolean; records: number; durationMs: number }[];
    evidenceIds: string[];
  } | null;
  evidence: {
    ids: string[];
    stateHashAtProposal: string | null;
    stateHashNow: string | null;
    moved: boolean;
    staleDetail: Record<string, unknown> | null;
  };
  signals: { id: string; kind: string; status: string; title: string; createdAt: string; resolvedAt: string | null }[];
  request: { id: string; subject: string; body: string; status: string; createdAt: string } | null;
  /** Verified only when the signal this began with closed; executed is not resolved. */
  outcome: { state: 'verified' | 'awaiting' | 'none'; label: string; ref: string | null; at: string | null };
  summary: {
    decisionId: string;
    subject: string | null;
    kind: string;
    status: string;
    evidenceFingerprint: string | null;
    createdAt: string;
    proposedBy: { id: string; name: string; role: string } | null;
    decidedBy: { id: string; name: string; role: string } | null;
    decidedAt: string | null;
    decision: string | null;
    edit: string | null;
    executedAt: string | null;
    executionRef: string | null;
  };
  timeline: LedgerEvent[];
}

/** One event of a decision's ledger: what a glance needs on the row, the provenance behind a click. */
export interface LedgerEvent {
  at: string;
  kind: 'signal' | 'investigated' | 'prepared' | 'decided' | 'executed' | 'outcome';
  label: string;
  detail: string;
  by: { name: string; role: string } | null;
  ref: string | null;
  result:
    | 'open'
    | 'read'
    | 'prepared'
    | 'approved'
    | 'declined'
    | 'stale'
    | 'refused'
    | 'executed'
    | 'done'
    | 'resolved'
    | 'awaiting';
  provenance: {
    evidenceIds: string[];
    stateHash: string | null;
    rule: string | null;
    correlationId: string | null;
    executionRef: string | null;
    auditId: string | null;
  };
}

/** One step of a run's flight record: what ran, for how long, with what came back; its provenance behind a click. */
export interface FlightStep {
  seq: number;
  name: string;
  kind: 'policy' | 'authorize' | 'tool' | 'model' | 'compose' | 'cache' | 'verifier' | 'response' | 'pause' | 'record';
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'failed' | 'refused' | 'waiting' | 'resumed';
  summary: string;
  provenance: {
    tool: string | null;
    toolVersion: string | null;
    input: string | null;
    output: string | null;
    records: string[];
    stateHash: string | null;
    rule: string | null;
    error: string | null;
    attempt: number | null;
    ref: string | null;
  };
  redactions: number;
}

/** `GET /ask/runs/:id/flight`: one run on one axis — never a thought, only what ran. */
export interface FlightRecord {
  runId: string;
  question: string;
  actor: { userId: string; role: string } | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'refused' | 'waiting' | 'resumed' | 'failed';
  stateHash: string | null;
  provider: { kind: 'deterministic' | 'model' | 'cache'; model: string | null };
  promptVersion: string | null;
  tokens: { input: number | null; output: number | null };
  steps: FlightStep[];
  result: {
    statements: number;
    abstentions: string[];
    conflicts: number;
    summary: string;
    verified: boolean | null;
    rejected: number;
  } | null;
  decisionRefs: { id: string; kind: string; status: string }[];
  links: { question: string; xray: string | null; decisions: string[] };
  redactions: number;
}

/** `GET /ask/runs/:id`: one answer as a flight record — every stage's time, every tool's time, what came back. */
export interface AskRun {
  id: string;
  conversationId: string;
  at: string;
  question: string;
  model: string | null;
  latencyMs: number | null;
  servedFromCache: boolean;
  promptVersion: string | null;
  contextVersion: string | null;
  tokens: { input: number | null; output: number | null };
  phases: Record<string, number | boolean> | null;
  toolCalls: {
    seq: number;
    name: string;
    input: unknown;
    ok: boolean;
    idsReturned: string[];
    durationMs: number;
    contextVersion: string | null;
  }[];
  answer: { statements: number; abstentions: string[]; conflicts: number; summary: string } | null;
  evidenceIds: string[];
  proposals: { id: string; kind: string; status: string }[];
}

export interface AskRunSummary {
  id: string;
  at: string;
  question: string;
  model: string | null;
  latencyMs: number | null;
  tools: number;
  failedTools: number;
  verified: boolean | null;
  servedFromCache: boolean;
}

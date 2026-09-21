import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { MetricsLive } from '@/components/platform/metrics-live';
import { StatusPill, type Tone } from '@/components/ui/status-pill';
import { currentActor } from '@/lib/actor';
import { apiFetch } from '@/lib/api';
import { ago, label } from '@/lib/format';
import type { ConsumerRegistration, DomainEventRow, JobRecord, PlatformMetrics } from '@/lib/types';

export const metadata = { title: 'Architecture' };

/**
 * Not a diagram: the running system describing itself. Boundaries are the modules that
 * exist; consumers come from the dispatcher's registry; queue, cache and breaker numbers
 * come from the ledger and the counters. The prose says what is cached and why, when
 * retries stop, and what the assistant is allowed to do — the questions a senior review asks.
 */
const CONTEXTS: { name: string; owns: string; events: string; module: string }[] = [
  {
    name: 'Reproduction',
    owns: 'Embryo, Transfer, Recipient, Contract, SemenOrder, the Day Sheet, intake by text',
    events: 'EmbryoExpected, IntakeConfirmed, ContractStatusChanged, HorseUpdated',
    module: 'modules/reproduction',
  },
  {
    name: 'Veterinary',
    owns: 'PregnancyCheck and the milestone → invoice rule',
    events: 'CheckRecorded, MilestoneInvoiced',
    module: 'modules/veterinary',
  },
  {
    name: 'Billing',
    owns: 'Invoice, Payment, Refund; Stripe behind an adapter and a write-once inbox',
    events: 'PaymentSucceeded, PaymentProcessing, PaymentFailed, PaymentRefunded, InvoicePaid',
    module: 'modules/billing',
  },
  {
    name: 'Accounting',
    owns: 'AccountingMapping, SyncAttempt, Discrepancy; QuickBooks behind a port with a simulator',
    events: 'EntitySynced, DiscrepancyRaised, DiscrepancyResolved',
    module: 'modules/accounting',
  },
  {
    name: 'Operations',
    owns: 'OperationalException — one shape for every source’s “needs a person”',
    events: 'consumes JobDeadLettered, JobRecovered, Discrepancy*, Check*, Embryo*, Payment*',
    module: 'modules/operations',
  },
  {
    name: 'Ask',
    owns: 'Conversation, Feedback, Memory, Eval cases and runs; the assistant over projections',
    events: '— (read-only; never produces business facts)',
    module: 'modules/ask',
  },
];

const PLATFORM: { name: string; what: string }[] = [
  {
    name: 'events',
    what: 'Transactional outbox (DomainEvent) → domain-event jobs → idempotent consumers (ProcessedEvent PK). At-least-once delivery, exactly-once effect per consumer.',
  },
  {
    name: 'queue',
    what: 'BullMQ on Redis with an inline fallback; a durable JobRecord ledger in either mode; retries with back-off; rate-limit and open-circuit pauses do not spend attempts; exhausted attempts dead-letter into an exception; recovery closes it.',
  },
  {
    name: 'resilience',
    what: 'Per-dependency circuit breaker (3 transient failures → open → cooldown → one probe); per-endpoint rate limits (search 100/min, ask 20/min, payments 5/min, login 10/min/ip; webhooks signature-verified instead).',
  },
  {
    name: 'cache',
    what: 'Redis or memory. Cached: horse summaries, assistant projections. Never cached: balances, ACH settlement, reconciliation, clearances. Invalidated by domain events; TTL is the safety net.',
  },
  {
    name: 'observability',
    what: 'One correlation id from the web click through jobs, events, accounting calls and audit rows; structured logs carry it; Sentry is tagged with it; /platform/trace/:id reconstructs the story.',
  },
  {
    name: 'security',
    what: 'Per-request HS256 token minted from the session; RBAC matrix enforced at the service and tool layer; customers see only their rows.',
  },
];

export default async function ArchitecturePage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'platform')) return <NotForRole page="Architecture" role={actor.role} />;
  const [metrics, consumers, jobs, events] = await Promise.all([
    apiFetch<PlatformMetrics>('/platform/metrics'),
    apiFetch<ConsumerRegistration[]>('/platform/consumers'),
    apiFetch<JobRecord[]>('/platform/jobs?limit=12'),
    apiFetch<DomainEventRow[]>('/platform/events?limit=12'),
  ]);
  const breakerTone = (state: string): Tone =>
    state === 'closed' ? 'ok' : state === 'half-open' ? 'warn' : 'critical';
  const m = metrics.metrics;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">
          A modular monolith · <MetricsLive />
        </p>
        <h1 className="text-2xl font-bold">Architecture</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Live: modules, the consumer registry, the ledger, the counters.
        </p>
      </div>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Queue"
          value={`${metrics.stores.queue}${metrics.jobs.paused ? ' · paused' : ''}`}
          sub={
            [
              ...Object.entries(metrics.jobs.byStatus).map(([k, v]) => `${k.toLowerCase()} ${v}`),
              ...((metrics.jobs.byStatus['DEAD'] ?? 0) > 0
                ? ['a dead job is an open exception; a person retries it from Operations']
                : []),
            ].join(' · ') || 'no jobs yet'
          }
        />
        <Stat
          label="Outbox lag"
          value={`${metrics.outbox.unpublished} unpublished`}
          sub={
            metrics.outbox.oldestUnpublishedAgeMs === null
              ? 'nothing waiting'
              : `oldest ${Math.round(metrics.outbox.oldestUnpublishedAgeMs / 1000)}s`
          }
        />
        <Stat
          label="Cache"
          value={`${Math.round(m.cache.hitRatio * 100)}% hit`}
          sub={`${m.cache.hits} hits · ${m.cache.misses} misses · ${m.cache.invalidations} invalidations · ${metrics.stores.cache} · counted since the API started`}
        />
        <Stat
          label="HTTP"
          value={`${m.http.requests} requests`}
          sub={`${m.http.errors} 5xx · rate-limited ${m.rateLimit.rejected} · up ${Math.round(m.uptimeSeconds / 60)} min`}
        />
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">Circuit breakers</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(metrics.breakers).length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No dependency has been called yet.</p>
          ) : null}
          {Object.entries(metrics.breakers).map(([dep, b]) => (
            <div key={dep} className="rounded-md border px-3 py-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="font-medium">{dep}</span>
                <StatusPill tone={breakerTone(b.state)}>{b.state}</StatusPill>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {b.consecutiveFailures} consecutive failure{b.consecutiveFailures === 1 ? '' : 's'} · opens at{' '}
                {b.options.failureThreshold} · cooldown {Math.round(b.options.cooldownMs / 1000)}s · since{' '}
                {ago(b.since)}
                {b.retryAfterMs ? ` · probe in ${Math.ceil(b.retryAfterMs / 1000)}s` : ''}
              </p>
              {b.lastError ? (
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{b.lastError}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">Bounded contexts</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Context</th>
                <th className="px-3 py-2 font-medium">Owns</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {CONTEXTS.map((c) => (
                <tr key={c.name} className="align-top">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.owns}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{c.events}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{c.module}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="eyebrow">Event consumers · from the dispatcher’s registry</h2>
          <ul className="divide-y rounded-md border text-[12px]">
            {consumers.map((c) => (
              <li key={c.name} className="grid gap-x-3 px-3 py-1.5 sm:grid-cols-[220px_1fr]">
                <span className="font-mono">{c.name}</span>
                <span className="text-muted-foreground">{c.events.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <h2 className="eyebrow">Platform</h2>
          <ul className="divide-y rounded-md border text-[12px]">
            {PLATFORM.map((p) => (
              <li key={p.name} className="grid gap-x-3 px-3 py-1.5 sm:grid-cols-[110px_1fr]">
                <span className="font-mono">{p.name}</span>
                <span className="text-muted-foreground">{p.what}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="eyebrow">Recent jobs · the ledger</h2>
          <ul className="divide-y rounded-md border text-[12px]">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <StatusPill tone={j.status === 'COMPLETED' ? 'ok' : j.status === 'DEAD' ? 'critical' : 'warn'}>
                  {j.status.toLowerCase()}
                </StatusPill>
                <span className="font-mono">{j.id}</span>
                <span className="text-muted-foreground">
                  attempt {j.attempts}/{j.maxAttempts} · {ago(j.updatedAt ?? j.createdAt)}
                </span>
                {j.lastError ? (
                  <span className="w-full break-all font-mono text-[11px] text-muted-foreground">
                    {j.lastError.slice(0, 120)}
                  </span>
                ) : null}
              </li>
            ))}
            {jobs.length === 0 ? <li className="px-3 py-3 text-muted-foreground">No jobs yet.</li> : null}
          </ul>
        </div>
        <div className="space-y-2">
          <h2 className="eyebrow">Recent domain events · the outbox</h2>
          <ul className="divide-y rounded-md border text-[12px]">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <StatusPill tone={e.publishedAt ? 'ok' : 'warn'}>{e.publishedAt ? 'published' : 'pending'}</StatusPill>
                <span className="font-medium">{e.type}</span>
                <span className="font-mono text-muted-foreground">
                  {e.aggregateType} {e.aggregateId}
                </span>
                <span className="text-muted-foreground">{ago(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">The assistant’s permissions</h2>
        <div className="rounded-md border px-3 py-2 text-[13px] text-muted-foreground">
          Reads projections, never tables: each tool returns the fields the model may see (no phone numbers, e-mail,
          payment methods) stamped with the codes it contains and a hash of its state. A policy layer answers money,
          mutation and clinical questions before a token is spent. The verifier strips any cited code the tools did not
          return. Every answer stores model, prompt version, tool versions and the state hash; a cached answer is served
          only against the same state. It can retrieve, explain, summarize, route and propose. It cannot change
          anything.
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Integrations:{' '}
        {Object.entries(metrics.integrations)
          .map(([k, v]) => `${label(k)} ${v}`)
          .join(' · ')}
        . Barn date {metrics.today}.
      </p>
    </div>
  );
}

function Stat({ label: text, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="eyebrow">{text}</p>
      <p className="mt-1 text-[16px] font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

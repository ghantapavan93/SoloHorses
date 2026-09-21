import { can } from '@daysheet/domain';
import { BriefHeader } from '@/components/operations/brief-header';
import { ExceptionBoard } from '@/components/operations/exception-board';
import { RequestDone } from '@/components/operations/request-done';
import { NotForRole } from '@/components/shell/not-for-role';
import { Code } from '@/components/record/timeline';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { currentActor } from '@/lib/actor';
import { apiFetch } from '@/lib/api';
import { ago, dateTime, label, usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  Brief,
  ExceptionDefinition,
  ExceptionKind,
  OperationalException,
  OperationsSummary,
  Signal,
  TeamRequest,
} from '@/lib/types';

export const metadata = { title: 'Operations' };

const OWNERS: Record<string, string> = {
  VET: 'Vet work',
  BILLING: 'Billing work',
  RECIPS: 'Recip farm work',
  STALLION_OFFICE: 'Stallion office work',
  ADMIN: 'The office',
};
const OWNER_WORD: Record<string, string> = {
  VET: 'veterinary',
  BILLING: 'billing',
  RECIPS: 'recip farm',
  STALLION_OFFICE: 'stallion office',
  ADMIN: 'office',
};

/**
 * One owner's share of the board, as the assistant's "open vet work" opens it: exactly the rows
 * that owner acts on, each a door to its signal, nothing else on the screen.
 */
async function Worklist({ owner }: { owner: string }) {
  const rank = (s: Signal) => (s.severity === 'CRITICAL' ? 0 : s.severity === 'WARN' ? 1 : 2);
  const rows = (await apiFetch<Signal[]>(`/operations/signals?owner=${encodeURIComponent(owner)}`)).sort(
    (a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <div className="space-y-4" data-testid="worklist">
      <div>
        <p className="eyebrow">Worklist · {OWNER_WORD[owner] ?? owner.toLowerCase()}</p>
        <h1 className="text-2xl font-bold">
          {rows.length === 0
            ? `Nothing waits on ${OWNER_WORD[owner] ?? owner.toLowerCase()}`
            : `${rows.length} case${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} ${OWNER_WORD[owner] ?? owner.toLowerCase()} action`}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {OWNERS[owner] ?? 'Work'}, as the board holds it now ·{' '}
          <Link href="/operations" className="underline underline-offset-2">
            all signals
          </Link>
        </p>
      </div>
      <ol className="divide-y rounded-md border">
        {rows.map((s) => (
          <li key={s.id}>
            <Link
              href={`/signals/${s.id}`}
              className="row flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted/40"
              data-testid="worklist-row"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  s.severity === 'CRITICAL'
                    ? 'bg-critical'
                    : s.severity === 'WARN'
                      ? 'bg-warn'
                      : 'bg-muted-foreground/60',
                )}
                aria-hidden
              />
              <span className="code w-[92px] shrink-0 text-[12px]">{s.entityId ?? s.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
              <span className="hidden text-[12px] text-muted-foreground md:inline">{s.next}</span>
              {s.stake ? <span className="money hidden text-[12px] sm:inline">{usd(s.stake.amountCents)}</span> : null}
              <span className="text-[11px] text-muted-foreground">{ago(s.createdAt)}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            Nothing open for this owner right now.
          </li>
        ) : null}
      </ol>
    </div>
  );
}

/**
 * Today is a projection of unresolved exceptions. Every source — Stripe, the books, the
 * queue, reproduction, veterinary, intake — lands here in one shape, and the person who
 * resolves it leaves an audited note.
 */
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; tab?: string }>;
}) {
  const actor = await currentActor();
  if (!can(actor, 'read', 'operations')) return <NotForRole page="Operations" role={actor.role} />;
  const { owner, tab } = await searchParams;
  if (owner && owner in OWNERS) return <Worklist owner={owner} />;
  const [summary, brief, open, resolved, kinds, requests] = await Promise.all([
    apiFetch<OperationsSummary>('/operations/summary'),
    apiFetch<Brief>('/operations/brief'),
    apiFetch<OperationalException[]>('/operations/exceptions'),
    apiFetch<OperationalException[]>('/operations/exceptions?status=RESOLVED,IGNORED'),
    apiFetch<Record<ExceptionKind, ExceptionDefinition>>('/operations/kinds'),
    apiFetch<TeamRequest[]>('/requests'),
  ]);
  const canAct = can(actor, 'write', 'operations');

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">All signals</p>
        <h1 className="text-2xl font-bold">
          {summary.open === 0
            ? 'Nothing requires attention'
            : `${summary.open} thing${summary.open === 1 ? '' : 's'} require${summary.open === 1 ? 's' : ''} attention`}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {summary.atStakeCents > 0 ? (
            <>
              <span className="money font-semibold text-foreground">{usd(summary.atStakeCents)}</span> waits on{' '}
              {summary.withStake} of them.{' '}
            </>
          ) : null}
          Every source, one shape. Rules raise them; people resolve them.
        </p>
      </div>

      <BriefHeader brief={brief} />

      <Tabs defaultValue={tab === 'requests' || tab === 'history' ? tab : 'board'}>
        <TabsList>
          <TabsTrigger value="board">
            Board <Count n={open.length} />
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests to the team <Count n={requests.filter((r) => r.status === 'OPEN').length} />
          </TabsTrigger>
          <TabsTrigger value="history">
            Resolved <Count n={resolved.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <ExceptionBoard rows={open} kinds={kinds} canAct={canAct} />
        </TabsContent>

        <TabsContent value="requests">
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-md border p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="code text-muted-foreground">{r.id}</span>
                    <span className="font-medium">{r.subject}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {r.createdBy ? `${r.createdBy.name} · ${label(r.createdBy.role)} · ` : ''}
                    {dateTime(r.createdAt)}{' '}
                    <StatusPill tone={r.status === 'OPEN' ? 'warn' : 'neutral'}>{label(r.status)}</StatusPill>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                {r.evidenceIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.evidenceIds.map((id) => (
                      <Code key={id} id={id} />
                    ))}
                  </div>
                ) : null}
                {r.status === 'OPEN' && canAct ? <RequestDone id={r.id} /> : null}
              </li>
            ))}
            {requests.length === 0 ? (
              <li className="rounded-md border border-dashed px-3 py-8 text-center text-[13px] text-muted-foreground">
                No requests yet. Ask (⌘J) → “Send to team”.
              </li>
            ) : null}
          </ul>
        </TabsContent>

        <TabsContent value="history">
          <ul className="space-y-1.5 text-[13px]">
            {resolved.slice(0, 100).map((x) => (
              <li key={x.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="neutral">{label(x.status)}</StatusPill>
                  <span className="code text-muted-foreground">{x.id}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {kinds[x.kind].label} · {x.resolvedAt ? dateTime(x.resolvedAt) : ''}
                    {x.resolvedBy ? ` · ${x.resolvedBy.name}` : ' · automatic'}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{x.title}</p>
                {x.resolution ? <p className="mt-0.5 text-[12px]">↳ {x.resolution}</p> : null}
              </li>
            ))}
            {resolved.length === 0 ? (
              <li className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">
                Nothing resolved yet.
              </li>
            ) : null}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-sm bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>;
}

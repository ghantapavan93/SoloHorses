import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CHECK_MILESTONES, daysBetween, evaluateDeparture, gestationDay, type ClearanceRecord } from '@daysheet/domain';
import { AskButtons } from '@/components/ask/ask-buttons';
import { FocusLive } from '@/components/record/focus-live';
import { Code } from '@/components/record/timeline';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { apiFetchOrNull } from '@/lib/api';
import { day, label } from '@/lib/format';
import type { DecisionRow, Health, Horse, TeamRequest, Xray } from '@/lib/types';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

type Focus = 'checks' | 'departure' | 'clearances' | null;
const FOCUSES: readonly string[] = ['checks', 'departure', 'clearances'];

/**
 * One horse. For a recip, the parts the assistant sends a person to are their own sections —
 * the pregnancy checks as a ladder with the missing one lit, the departure and the video the
 * lease wants, the clearances — each scrolled to and kept live when the address names it
 * (`?focus=checks`). The address is the assistant's typed door, resolved by the server.
 */
export default async function HorseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const [{ id }, { focus: rawFocus }] = await Promise.all([params, searchParams]);
  const focus: Focus = rawFocus && FOCUSES.includes(rawFocus) ? (rawFocus as Focus) : null;
  const [horse, health, requests] = await Promise.all([
    apiFetchOrNull<Horse>(`/horses/${encodeURIComponent(id)}`),
    apiFetchOrNull<Health>('/health'),
    apiFetchOrNull<TeamRequest[]>('/requests'),
  ]);
  if (!horse) notFound();
  const isRecip = horse.kind === 'RECIPIENT';
  // A recip's workspace opens on what blocks her: the x-ray's block, and the decisions about her.
  const [xray, proposals] = isRecip
    ? await Promise.all([
        apiFetchOrNull<Xray>(`/operations/xray/${encodeURIComponent(horse.id)}`),
        apiFetchOrNull<DecisionRow[]>('/proposals?status=all'),
      ])
    : [null, null];
  const decisions = (proposals ?? []).filter((row) =>
    ['recipId', 'recipientId'].some((key) => row.payload[key] === horse.id),
  );
  const decision = decisions.find((row) => row.status === 'PROPOSED') ?? decisions[0] ?? null;
  const today = health?.today ?? new Date().toISOString().slice(0, 10);
  const carrying =
    horse.transfers.find((t) => t.embryo.status === 'TRANSFERRED' || t.embryo.status === 'PREGNANT') ??
    horse.transfers[0] ??
    null;
  const open = (requests ?? []).filter((r) => r.status === 'OPEN' && r.evidenceIds.includes(horse.id));
  const clearances: ClearanceRecord[] = (horse.clearances ?? []).map((c) => ({
    id: c.id,
    kind: c.kind as ClearanceRecord['kind'],
    result: c.result as ClearanceRecord['result'],
    performedOn: c.performedOn.slice(0, 10),
    expiresOn: c.expiresOn?.slice(0, 10) ?? null,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">
            {label(horse.kind)} · {label(horse.site)}
          </p>
          <h1 className="font-display text-2xl font-medium tracking-wide">{horse.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <span className="code">{horse.id}</span>
            {horse.birthYear ? ` · foaled ${horse.birthYear}` : ''}
            {horse.owner ? (
              <>
                {' '}
                · owner{' '}
                <Link className="hover:underline" href={`/customers/${horse.owner.id}`}>
                  {horse.owner.displayName}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {isRecip && horse.recipStatus ? (
          <StatusPill
            tone={horse.recipStatus === 'CARRYING' ? 'ok' : horse.recipStatus === 'SET_UP' ? 'warn' : 'neutral'}
          >
            {label(horse.recipStatus)}
          </StatusPill>
        ) : null}
      </header>

      {xray ? (
        <section
          className={cn('rounded-md border px-4 py-3', xray.block ? 'border-warn/50 bg-warn/5' : 'border-ok/40')}
          data-testid="current-blocker"
          aria-labelledby="blocker-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p id="blocker-heading" className={cn('readout', xray.block ? 'text-warn' : 'text-ok')}>
                {xray.block ? 'blocked' : 'clear'}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold leading-snug">
                {xray.block ? xray.block.label : 'Nothing about her waits on a person'}
              </p>
              {xray.unresolvedBoundary ? (
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {label(xray.unresolvedBoundary.owner)} decides · {xray.unresolvedBoundary.next}
                </p>
              ) : null}
            </div>
            <AskButtons
              subject={horse.id}
              vet={xray.unresolvedBoundary?.owner === 'VET' && open.length === 0}
              decisionHref={decision ? `/decisions/${decision.id}` : null}
              decisionStatus={decision?.status ?? null}
            />
          </div>
          {xray.nodes.some((n) => n.type === 'money' || n.type === 'record') ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="connected">
              <span className="readout text-muted-foreground">connected</span>
              {xray.nodes
                .filter((n) => n.recordRef && n.recordRef !== horse.id && (n.type === 'record' || n.type === 'money'))
                .slice(0, 6)
                .map((n) => (
                  <span key={n.id} className="inline-flex items-center gap-1">
                    <Code id={n.recordRef ?? ''} />
                    {n.type === 'money' ? (
                      <span className="text-muted-foreground">{n.label.split(' · ')[1] ?? ''}</span>
                    ) : null}
                  </span>
                ))}
              {open.map((r) => (
                <Code key={r.id} id={r.id} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {isRecip && carrying ? (
        <FocusLive
          id="checks"
          focused={focus === 'checks'}
          announce={focus === null || focus === 'checks'}
          about={[horse.id, carrying.embryoId]}
          className="p-3"
        >
          <PregnancyChecks transfer={carrying} today={today} />
        </FocusLive>
      ) : null}

      {isRecip && (horse.scheduledDepartureOn || focus === 'departure') ? (
        <FocusLive
          id="departure"
          focused={focus === 'departure'}
          announce={focus === 'departure'}
          about={[horse.id]}
          className="p-3"
        >
          <Departure horse={horse} today={today} clearances={clearances} open={open} />
        </FocusLive>
      ) : null}

      {isRecip && (clearances.length > 0 || focus === 'clearances') ? (
        <FocusLive
          id="clearances"
          focused={focus === 'clearances'}
          announce={focus === 'clearances'}
          about={[horse.id]}
          className="p-3"
        >
          <h2 className="text-[13px] font-semibold">Clearances</h2>
          {clearances.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">None on record.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border text-[12.5px]">
              {clearances.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
                  <span className="code text-muted-foreground">{c.id}</span>
                  <span className="font-medium">{label(c.kind)}</span>
                  <span className={cn('readout', c.result === 'CLEAR' ? 'text-ok' : 'text-warn')}>
                    {c.result.toLowerCase()}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {day(c.performedOn)}
                    {c.expiresOn ? ` · expires ${day(c.expiresOn)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FocusLive>
      ) : null}

      {horse.transfers.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold">{isRecip ? 'Carried' : 'Transfers'}</h2>
          <ul className="divide-y rounded-md border text-[13px]">
            {horse.transfers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <Link className="code hover:underline" href={`/embryos/${t.embryoId}`}>
                    {t.embryoId}
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}
                    · transferred {day(t.performedOn)}
                    {t.checks[0]
                      ? ` · last check day ${t.checks[0].dayNumber}: ${label(t.checks[0].result)} (${day(t.checks[0].performedOn)})`
                      : ' · no checks yet'}
                  </span>
                </span>
                <StatusPill tone={toneForStatus(t.embryo.status)}>{label(t.embryo.status)}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {horse.contractsAsStallion.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold">Book</h2>
          <ul className="divide-y rounded-md border text-[13px]">
            {horse.contractsAsStallion.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <Link className="code hover:underline" href={`/contracts/${c.id}`}>
                    {c.id}
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}
                    · {c.customer.displayName} · {label(c.type)}
                  </span>
                </span>
                <StatusPill tone={toneForStatus(c.status)}>{label(c.status)}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {horse.embryosAsDam.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold">Embryos out of this mare</h2>
          <ul className="flex flex-wrap gap-1.5">
            {horse.embryosAsDam.map((e) => (
              <li key={e.id}>
                <Link
                  className="code inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                  href={`/embryos/${e.id}`}
                >
                  {e.id} <span className="text-muted-foreground">{label(e.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The checks as a ladder, one rung per milestone the rules bill or watch: recorded, with its
 * result and date; missing, when the day has passed and nothing is on record; or ahead. The
 * missing rung is the one the assistant meant.
 */
function PregnancyChecks({ transfer, today }: { transfer: Horse['transfers'][number]; today: string }) {
  const dayNow = gestationDay(transfer.performedOn.slice(0, 10), today);
  const upcoming = CHECK_MILESTONES.find((m) => m > dayNow) ?? null;
  const rungs = CHECK_MILESTONES.filter((m) => m <= dayNow || m === upcoming);
  const checkFor = (milestone: number) => {
    const next = CHECK_MILESTONES.find((m) => m > milestone) ?? Number.POSITIVE_INFINITY;
    return (
      [...transfer.checks]
        .sort((a, b) => a.dayNumber - b.dayNumber)
        .find((c) => c.dayNumber >= milestone && c.dayNumber < next) ?? null
    );
  };
  return (
    <div>
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold">
        Pregnancy checks
        <span className="text-[12px] font-normal text-muted-foreground">
          <Link href={`/embryos/${transfer.embryoId}`} className="code hover:underline">
            {transfer.embryoId}
          </Link>{' '}
          · day {dayNow} · transferred {day(transfer.performedOn)}
        </span>
      </h2>
      <ol className="mt-2 divide-y rounded-md border text-[12.5px]" data-testid="pregnancy-checks">
        {rungs.map((milestone) => {
          const check = checkFor(milestone);
          const state = check ? 'recorded' : milestone <= dayNow ? 'missing' : 'ahead';
          return (
            <li
              key={milestone}
              className={cn('flex flex-wrap items-center gap-x-3 px-3 py-1.5', state === 'missing' && 'bg-warn/10')}
              data-testid={`check-${state}`}
              data-milestone={milestone}
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  state === 'recorded'
                    ? 'bg-ok'
                    : state === 'missing'
                      ? 'bg-warn ring-4 ring-warn/20'
                      : 'border border-muted-foreground/60',
                )}
                aria-hidden
              />
              <span className="w-[64px] shrink-0 font-medium">Day {milestone}</span>
              {check ? (
                <>
                  <span
                    className={cn(
                      'readout',
                      check.result === 'OPEN' || check.result === 'LOST' ? 'text-critical' : 'text-ok',
                    )}
                  >
                    {label(check.result)}
                  </span>
                  <span className="text-muted-foreground">
                    recorded day {check.dayNumber} · {day(check.performedOn)}
                  </span>
                  <span className="code ml-auto text-muted-foreground">{check.id}</span>
                </>
              ) : state === 'missing' ? (
                <>
                  <span className="readout text-warn">missing</span>
                  <span className="text-muted-foreground">
                    nothing on record since day {milestone}; today is day {dayNow}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  ahead · in {milestone - dayNow} day{milestone - dayNow === 1 ? '' : 's'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The departure the lease binds: the day, the video check it wants within three days of it, the rule's word, and the request already on its way. */
function Departure({
  horse,
  today,
  clearances,
  open,
}: {
  horse: Horse;
  today: string;
  clearances: ClearanceRecord[];
  open: TeamRequest[];
}) {
  const scheduled = horse.scheduledDepartureOn?.slice(0, 10) ?? null;
  const verdict = evaluateDeparture({ id: horse.id, scheduledDepartureOn: scheduled, clearances }, today);
  const video = clearances.find((c) => c.kind === 'VIDEO_IN_FOAL') ?? null;
  const days = scheduled ? daysBetween(today, scheduled) : null;
  return (
    <div>
      <h2 className="text-[13px] font-semibold">Departure</h2>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]" data-testid="departure">
        <dt className="readout text-muted-foreground">leaves</dt>
        <dd>
          {scheduled ? (
            <>
              {day(scheduled)}{' '}
              <span className="text-muted-foreground">
                · {days !== null && days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : 'date passed'}
              </span>
            </>
          ) : (
            'not scheduled'
          )}
        </dd>
        <dt className="readout text-muted-foreground">video check</dt>
        <dd className={cn(!video && scheduled && 'text-warn')} data-testid="departure-video">
          {video ? (
            <>
              {label(video.result)} · {day(video.performedOn)}{' '}
              <span className="code text-muted-foreground">{video.id}</span>
            </>
          ) : (
            'none on record · the lease wants one within 3 days of departure'
          )}
        </dd>
        <dt className="readout text-muted-foreground">rule</dt>
        <dd data-testid="departure-rule">
          {verdict.ok ? (
            <span className="readout text-ok">may leave</span>
          ) : (
            <>
              <span className="code text-warn">{verdict.code}</span>{' '}
              <span className="text-muted-foreground">· {verdict.reason.split(';')[0]}</span>
            </>
          )}
        </dd>
        <dt className="readout text-muted-foreground">request</dt>
        <dd data-testid="departure-requests">
          {open.length === 0 ? (
            <span className="text-muted-foreground">none open</span>
          ) : (
            open.map((r) => (
              <span key={r.id} className="block">
                <span className="code text-muted-foreground">{r.id}</span>{' '}
                <Link href="/operations?tab=requests" className="underline underline-offset-2">
                  {r.subject}
                </Link>{' '}
                <span className="text-muted-foreground">
                  · open since {day(r.createdAt)}
                  {r.createdBy ? ` · ${r.createdBy.name}` : ''}
                </span>
              </span>
            ))
          )}
        </dd>
      </dl>
    </div>
  );
}

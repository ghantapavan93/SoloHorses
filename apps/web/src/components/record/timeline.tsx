import Link from 'next/link';
import {
  Activity,
  ArrowRightLeft,
  Beaker,
  CircleDollarSign,
  FlaskConical,
  MessageSquareText,
  PackageCheck,
  Receipt,
} from 'lucide-react';
import { dateTime, hrefFor, usd } from '@/lib/format';
import type { TimelineEvent } from '@/lib/types';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  intake: MessageSquareText,
  aspiration: FlaskConical,
  lab: Beaker,
  arrival: PackageCheck,
  transfer: ArrowRightLeft,
  check: Activity,
  invoice: Receipt,
  payment: CircleDollarSign,
};

/** Newest first. Every row carries the code of the record it describes, so it can be cited. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-[13px] text-muted-foreground">No events yet.</p>;
  return (
    <ol className="relative space-y-0 border-l pl-5">
      {events.map((e, i) => {
        const Icon = ICONS[e.kind] ?? Activity;
        return (
          <li key={`${e.id}-${e.kind}-${i}`} className="relative py-2.5">
            <span className="absolute -left-[29px] top-3 flex size-4 items-center justify-center rounded-full border bg-background">
              <Icon className="size-2.5 text-muted-foreground" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[13px]">{e.title}</span>
              {e.amountCents !== undefined ? <span className="money text-[13px]">{usd(e.amountCents)}</span> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {dateTime(e.at)}
                {e.actor ? ` · ${e.actor}` : ''}
              </span>
            </div>
            {e.detail ? <p className="mt-0.5 text-[12px] text-muted-foreground">{e.detail}</p> : null}
            <div className="mt-1 flex flex-wrap gap-1">
              <Code id={e.id} />
              {e.links
                .filter((l) => l !== e.id)
                .map((l) => (
                  <Code key={l} id={l} />
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Code({ id }: { id: string }) {
  const href = hrefFor(id);
  const cls = 'code inline-flex rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground';
  return href ? (
    <Link href={href} className={`${cls} hover:bg-muted hover:text-foreground`}>
      {id}
    </Link>
  ) : (
    <span className={cls}>{id}</span>
  );
}

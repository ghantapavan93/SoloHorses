import Link from 'next/link';
import { hrefFor } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A record code as evidence: a link when the code has a page, plain otherwise. */
export function Chip({ id, highlight }: { id: string; highlight?: boolean }) {
  const href = hrefFor(id);
  const className = cn(
    'code inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px]',
    highlight ? 'border-brand text-brand' : 'text-muted-foreground',
    href && 'hover:bg-muted hover:text-foreground',
  );
  return href ? (
    <Link href={href} className={className}>
      {id}
    </Link>
  ) : (
    <span className={className}>{id}</span>
  );
}

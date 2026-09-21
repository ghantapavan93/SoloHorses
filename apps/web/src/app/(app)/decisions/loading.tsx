import { Skeleton } from '@/components/ui/skeleton';

/** The ledger's shape before its rows. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the decision ledger">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-3 w-[420px] max-w-full" />
      </div>
      <div className="space-y-px overflow-hidden rounded-md border">
        <Skeleton className="h-8 w-full rounded-none" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-none opacity-70" />
        ))}
      </div>
    </div>
  );
}

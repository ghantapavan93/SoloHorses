import { Skeleton } from '@/components/ui/skeleton';

/** The flight recorder's index before its rows. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the runs">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-[460px] max-w-full" />
      </div>
      <div className="space-y-px overflow-hidden rounded-md border">
        <Skeleton className="h-8 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-none opacity-70" />
        ))}
      </div>
    </div>
  );
}

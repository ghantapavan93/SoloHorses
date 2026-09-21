import { Skeleton } from '@/components/ui/skeleton';

/** The scorecard's shape before the run lands. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the evals">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <div className="rounded-md border">
        <div className="border-b px-3 py-2">
          <Skeleton className="h-2.5 w-48" />
        </div>
        <div className="space-y-2 px-3 py-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

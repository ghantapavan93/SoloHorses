import { Skeleton } from '@/components/ui/skeleton';

/** The day's shape before its rows: the brief's sentence, its numbers, three cards, the line to ask from, then the sheet. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading today">
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-full max-w-lg" />
          <Skeleton className="h-3.5 w-96 max-w-full" />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-md border px-3 py-2.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-full max-w-xl" />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-5">
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-40" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

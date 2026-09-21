import { Skeleton } from '@/components/ui/skeleton';

/** The board's shape before its rows: the brief's five tiles, three panels, then the list. Structure first, never a blank. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the board">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-3 w-96" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-background px-3 py-2.5">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border">
            <div className="border-b px-3 py-2">
              <Skeleton className="h-2.5 w-24" />
            </div>
            <div className="space-y-2 px-3 py-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

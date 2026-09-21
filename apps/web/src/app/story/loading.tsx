import { Skeleton } from '@/components/ui/skeleton';

/** The mare's page before her records: the header, the four counters, the x-ray's frame, the timeline. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8" aria-busy="true" aria-label="Loading the story">
      <Skeleton className="mb-5 h-3 w-64" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[520px] w-full" />
      </div>
    </main>
  );
}

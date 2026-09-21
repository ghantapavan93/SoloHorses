import { Skeleton } from '@/components/ui/skeleton';

/** One decision's page before its rows: the title, the timeline, the four questions. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8" aria-busy="true" aria-label="Loading the decision">
      <Skeleton className="mb-5 h-3 w-64" />
      <div className="mb-4 space-y-2">
        <Skeleton className="h-3 w-72" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-px overflow-hidden rounded-md border">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none opacity-70" />
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    </main>
  );
}

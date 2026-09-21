import { Skeleton } from '@/components/ui/skeleton';

/** One run's page before its stages. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8" aria-busy="true" aria-label="Loading the run">
      <Skeleton className="mb-5 h-3 w-64" />
      <div className="mb-4 space-y-2">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-8 w-full max-w-lg" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-px overflow-hidden rounded-md border">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-none opacity-70" />
        ))}
      </div>
      <Skeleton className="mt-3 h-40 w-full" />
    </main>
  );
}

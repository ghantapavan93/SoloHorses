import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-[13px]">
        <p className="eyebrow">404</p>
        <h1 className="text-lg font-semibold">That page could not be found.</h1>
        <p className="text-muted-foreground">
          The record may belong to someone else, or the code may be mistyped. Codes look like E-26-2041, SS-26-0533,
          R-0347.
        </p>
        <Link href="/today" className="underline">
          Back to the Day Sheet
        </Link>
      </div>
    </main>
  );
}

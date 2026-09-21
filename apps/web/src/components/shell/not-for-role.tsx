import Link from 'next/link';
import { ROLE_LABELS, type Role } from '@daysheet/domain';

/**
 * Shown when a page is opened by a role the RBAC matrix keeps out (a typed URL, a stale link).
 * The API refuses the read regardless; this only replaces a stack trace with a sentence.
 */
export function NotForRole({ page, role }: { page: string; role: Role }) {
  return (
    <div className="max-w-md space-y-2 text-[13px]">
      <p className="eyebrow">Not available</p>
      <h1 className="text-lg font-semibold">
        {page} is not part of the {ROLE_LABELS[role]} view.
      </h1>
      <p className="text-muted-foreground">
        Every role sees what its department sees; the API enforces the same matrix. Sign in as another role from the
        login page to open it.
      </p>
      <Link href="/today" className="underline">
        Back to the Day Sheet
      </Link>
    </div>
  );
}

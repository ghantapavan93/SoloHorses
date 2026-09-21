import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The three worlds and the door between them, in the order a reviewer takes them. */
const WORLDS = [
  { href: '/', label: 'Story' },
  { href: '/login?next=/today', label: 'Product' },
  { href: '/build', label: 'Proof' },
  { href: '/vision', label: 'Vision' },
];

/**
 * The public pages' top bar: the product's name, the three worlds, and whatever the page
 * puts at the right — the landing's palette, a sign-in. Fixed, glass over the story's dark.
 */
export function StoryNav({ current, children }: { current: '/' | '/build' | '/vision'; children?: React.ReactNode }) {
  return (
    <nav
      className="fixed inset-x-0 top-0 z-40 flex h-[64px] items-center justify-between gap-3 border-b border-white/[0.06] glass bg-[rgb(15_12_10/0.72)] px-[4vw]"
      aria-label="Worlds"
    >
      <Link href="/" className="flex items-center gap-3">
        <span>
          <span className="block font-heading text-[12px] font-extrabold uppercase tracking-[0.2em] text-paper">
            Daysheet
          </span>
          <span className="block text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
            Unofficial candidate build
          </span>
        </span>
      </Link>
      <div className="flex min-w-0 items-center gap-1">
        <ul className="hidden items-center gap-1 md:flex">
          {WORLDS.map((w) => (
            <li key={w.href}>
              <Link
                href={w.href}
                className={cn(
                  'rounded-lg px-3 py-2 text-[12px] transition-colors hover:bg-white/[0.06] hover:text-paper',
                  w.href === current ? 'text-paper' : 'text-muted-foreground',
                )}
                aria-current={w.href === current ? 'page' : undefined}
              >
                {w.label}
              </Link>
            </li>
          ))}
        </ul>
        {children}
        <Link href="/login" className="rounded-lg px-3 py-2 text-[12px] text-muted-foreground hover:text-paper">
          Sign in
        </Link>
      </div>
    </nav>
  );
}

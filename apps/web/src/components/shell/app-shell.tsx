'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  Coins,
  FileSignature,
  FlaskConical,
  Inbox,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  Search,
  Sparkles,
  X,
  Gavel,
  Timer,
} from 'lucide-react';
import { logoutAction } from '@/app/login/actions';
import { AskDock, AskDockProvider, useAskDock } from '@/components/ask/ask-dock';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AskStatus, Health, Role } from '@/lib/types';
import type { Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { CommandK } from './command-k';
import { ThemeToggle } from './theme-toggle';
import { dayLong } from '@/lib/format';

export interface ShellUser {
  name: string;
  email: string;
  role: Role;
  customerId: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[] | 'all';
}

const STAFF: Role[] = ['ADMIN', 'STALLION_OFFICE', 'RECIPS', 'VET', 'BILLING'];

/** The work, in the order the day runs: what matters, what waits on a person, the money. */
const NAV: NavItem[] = [
  { href: '/today', label: 'Today', icon: CalendarDays, roles: 'all' },
  { href: '/decisions', label: 'Decisions', icon: Gavel, roles: STAFF },
  { href: '/money', label: 'Money', icon: Coins, roles: ['ADMIN', 'BILLING'] },
  { href: '/requests', label: 'Requests', icon: MessageSquareText, roles: ['CUSTOMER'] },
];

/** The records themselves, and the board that reads them. */
const RECORDS: NavItem[] = [
  { href: '/embryos', label: 'Embryos', icon: FlaskConical, roles: 'all' },
  {
    href: '/contracts',
    label: 'Contracts',
    icon: FileSignature,
    roles: ['ADMIN', 'STALLION_OFFICE', 'BILLING', 'CUSTOMER'],
  },
  { href: '/intake', label: 'Intake', icon: Inbox, roles: ['ADMIN', 'STALLION_OFFICE', 'RECIPS'] },
  { href: '/operations', label: 'All signals', icon: Activity, roles: STAFF },
];

/** For engineers reviewing the build: the proof, one entry, folded until asked for. */
const ENGINEERING: NavItem[] = [
  { href: '/runs', label: 'Runs', icon: Timer, roles: STAFF },
  { href: '/evals', label: 'Evals', icon: ListChecks, roles: ['ADMIN'] },
  { href: '/lab', label: 'Lab', icon: Sparkles, roles: ['ADMIN'] },
  { href: '/build', label: 'Build', icon: Layers, roles: STAFF },
  { href: '/vision', label: 'Vision', icon: BookOpenText, roles: STAFF },
];

/** What ⌘J offers each role before anything is typed. */
const SUGGESTIONS: Record<Role, string[]> = {
  ADMIN: [
    'What is at stake today?',
    'What changed since yesterday?',
    'What needs attention right now?',
    'What is on the collection sheet today, and why is anything on hold?',
    'Which pregnancies cross a billing milestone this week?',
  ],
  STALLION_OFFICE: [
    "Which orders on today's sheet are on hold, and what would release each one?",
    'Is SS-26-0010 paid in full and signed?',
  ],
  RECIPS: [
    'Which embryos are expected in the next two days?',
    "Which of Jane Alder's embryos have not been checked in the last 7 days?",
    'What is on the transfer sheet today?',
  ],
  VET: ['Which checks are due today, and which one crosses day 24?', 'What did the last check on Recip #24 find?'],
  BILLING: [
    'How much money is waiting on a person?',
    'Which invoices are open past their due date?',
    'What does Jane Alder owe, by invoice?',
  ],
  CUSTOMER: [
    'Where are my embryos right now?',
    'When does board start on my recip?',
    'What do I still owe on my contract?',
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  STALLION_OFFICE: 'Stallion office',
  RECIPS: 'Recip farm',
  VET: 'Vet',
  BILLING: 'Billing',
  CUSTOMER: 'Customer',
};

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'row flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px]',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <item.icon className="size-3.5 shrink-0" />
      {item.label}
    </Link>
  );
}

/**
 * The shell: a dim sidebar that reads as part of the page, one header with the date, one
 * command surface (⌘K to search, ⌘J straight to Ask), the assistant's dock beside the page,
 * and the disclosure strip every screen of a candidate prototype must carry.
 */
export function AppShell(props: {
  user: ShellUser;
  today: string;
  demoClock: boolean;
  integrations: Health['integrations'];
  askStatus: AskStatus | null;
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <AskDockProvider>
      <Shell {...props} />
    </AskDockProvider>
  );
}

function Shell({
  user,
  today,
  demoClock,
  integrations,
  askStatus,
  theme,
  children,
}: {
  user: ShellUser;
  today: string;
  demoClock: boolean;
  integrations: Health['integrations'];
  askStatus: AskStatus | null;
  theme: Theme;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const dock = useAskDock();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // The proof pages stay folded unless the person opened them, or is on one.
  const [proofOpen, setProofOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setProofOpen(localStorage.getItem('daysheet:nav:proof') === '1');
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const toggleProof = () => {
    setProofOpen((v) => {
      try {
        localStorage.setItem('daysheet:nav:proof', v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };
  // The floating signal dock belongs to the public pages; inside the shell the board is a page.
  useEffect(() => {
    document.documentElement.dataset['shell'] = '1';
    return () => {
      delete document.documentElement.dataset['shell'];
    };
  }, []);
  // A question handed in by the address (`?ask=`, from a signal's "Ask about this") goes to the
  // dock, and the address is cleaned so a refresh does not ask it twice.
  const searchParams = useSearchParams();
  const router = useRouter();
  const handedQuestion = searchParams.get('ask')?.trim().slice(0, 300) || null;
  useEffect(() => {
    if (handedQuestion === null || !dock) return;
    dock.ask(handedQuestion);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('ask');
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
    // The dock's api is stable per open state; the question is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedQuestion]);

  const askDock = (question?: string) => {
    if (!dock) return;
    if (question) dock.ask(question);
    else dock.show();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (key === 'j') {
        e.preventDefault();
        dock?.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dock]);

  const forRole = (n: NavItem) => n.roles === 'all' || n.roles.includes(user.role);
  // A client's first item is her own record; the Day Sheet is the barn's.
  const items = NAV.filter(forRole).map((n) =>
    n.href === '/today' && user.role === 'CUSTOMER' && user.customerId
      ? { ...n, href: `/customers/${user.customerId}`, label: 'My records' }
      : n,
  );
  const records = RECORDS.filter(forRole);
  const engineering = ENGINEERING.filter(forRole);
  const simulated = Object.entries(integrations)
    .filter(([, mode]) => mode === 'simulated')
    .map(([k]) => k);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-11 items-center justify-between px-3">
            <Link
              href="/today"
              className="font-heading text-[12px] font-bold uppercase tracking-[0.2em] text-foreground"
            >
              Daysheet
            </Link>
            <button className="md:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation">
              <X className="size-4" />
            </button>
          </div>
          <nav className="flex-1 px-2 pt-1" aria-label="Primary">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="row mb-2 flex h-7 w-full items-center gap-2 rounded-md border border-sidebar-border px-2 text-[12px] text-sidebar-foreground hover:text-sidebar-accent-foreground"
            >
              <Search className="size-3.5" /> Search or ask
              <kbd className="ml-auto rounded border border-sidebar-border px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <div className="space-y-px">
              {items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={() => setNavOpen(false)} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                askDock();
                setNavOpen(false);
              }}
              className="row mt-px flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground hover:text-foreground"
              data-testid="nav-ask"
            >
              <Sparkles className="size-3.5" /> Ask
              <kbd className="ml-auto rounded border border-sidebar-border px-1 font-mono text-[10px]">⌘J</kbd>
            </button>
            {records.length > 0 ? (
              <div className="mt-5">
                <p className="eyebrow px-2 pb-1 text-[9px]">Records</p>
                <div className="space-y-px">
                  {records.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} onNavigate={() => setNavOpen(false)} />
                  ))}
                </div>
              </div>
            ) : null}
            {engineering.length > 0 ? (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={toggleProof}
                  className="flex w-full items-center gap-1 px-2 pb-1 text-left"
                  aria-expanded={proofOpen || engineering.some((i) => pathname.startsWith(i.href))}
                  data-testid="nav-proof"
                >
                  <ChevronRight
                    className={cn(
                      'size-3 text-muted-foreground transition-transform',
                      (proofOpen || engineering.some((i) => pathname.startsWith(i.href))) && 'rotate-90',
                    )}
                    aria-hidden
                  />
                  <span className="eyebrow text-[9px]">Proof</span>
                </button>
                {proofOpen || engineering.some((i) => pathname.startsWith(i.href)) ? (
                  <div className="space-y-px">
                    {engineering.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} onNavigate={() => setNavOpen(false)} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </nav>
          <div className="space-y-2 border-t border-sidebar-border p-3 text-[12px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{user.name}</div>
                <div className="truncate text-sidebar-foreground">
                  {ROLE_LABEL[user.role]}
                  {user.customerId ? ` · ${user.customerId}` : ''}
                </div>
              </div>
              <ThemeToggle theme={theme} />
            </div>
            <form action={logoutAction}>
              <button type="submit" className="flex items-center gap-1.5 text-sidebar-foreground hover:text-foreground">
                <LogOut className="size-3.5" /> Sign out
              </button>
            </form>
          </div>
        </aside>
        {navOpen ? (
          <button
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        ) : null}

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-5">
            <button className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <span className="text-[12.5px] font-medium">{dayLong(`${today}T12:00:00Z`)}</span>
              {demoClock ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-2 rounded-sm bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
                      demo clock
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>The calendar date is frozen so the synthetic season stays coherent.</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dock?.toggle()}
              className={cn(
                'row inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] hover:text-foreground',
                dock?.open ? 'bg-muted text-foreground' : 'text-muted-foreground',
              )}
              aria-pressed={dock?.open ?? false}
              data-testid="header-ask"
            >
              <Sparkles className="size-3.5" /> Ask{' '}
              <kbd className="ml-1 hidden rounded border px-1 font-mono text-[10px] md:inline">⌘J</kbd>
            </button>
          </header>

          <div className="border-b px-3 py-1 text-[10.5px] text-muted-foreground md:px-5">
            Unofficial candidate prototype · synthetic data · Stripe test mode
            {simulated.length > 0 ? ` · simulated: ${simulated.join(', ')}` : ''} ·{' '}
            <Link href="/about" className="underline underline-offset-2">
              assumptions
            </Link>
          </div>

          <main className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-5">{children}</main>
        </div>

        <AskDock askStatus={askStatus} suggestions={SUGGESTIONS[user.role]} userKey={user.email || user.name} />

        <CommandK
          open={paletteOpen}
          view="search"
          onOpenChange={setPaletteOpen}
          onViewChange={() => undefined}
          askStatus={askStatus}
          suggestions={SUGGESTIONS[user.role]}
          onAsk={(q) => askDock(q)}
        />
      </div>
    </TooltipProvider>
  );
}

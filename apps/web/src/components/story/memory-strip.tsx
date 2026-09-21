'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { forgetAction } from '@/lib/actions';
import { label } from '@/lib/format';
import type { Memory } from '@/lib/types';

/**
 * What the assistant remembers, in the open: every entry has a scope, a key, a value and a
 * source, and a person can remove it. Memory never decides anything; it shapes wording.
 * The public reviewer reads; a signed-in person may forget.
 */
export function MemoryStrip({ rows, signedIn }: { rows: Memory[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const forget = (id: string) =>
    start(async () => {
      const res = await forgetAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Forgotten. The next answer will not use it.');
    });

  return (
    <div className="border-t text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        What Ask remembers <span className="tabular-nums">({rows.length})</span>
      </button>
      {open ? (
        <ul className="divide-y border-t">
          {rows.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <span className="mr-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.scope === 'ORG' ? 'everyone' : 'this user'}
                </span>
                <span className="code">{m.key}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{label(m.source)}</span>
                <p className="mt-0.5 text-foreground">{m.value}</p>
              </div>
              {signedIn ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  aria-label={`Forget ${m.key}`}
                  disabled={pending}
                  onClick={() => forget(m.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
          {rows.length === 0 ? <li className="px-4 py-3 text-muted-foreground">Nothing remembered.</li> : null}
          <li className="px-4 py-2 text-[11px] text-muted-foreground">
            Wording only — never a record or a rule.{' '}
            {signedIn ? (
              <Link href="/memory" className="underline">
                Edit
              </Link>
            ) : (
              <Link href="/login?next=/memory" className="underline">
                Sign in to edit
              </Link>
            )}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

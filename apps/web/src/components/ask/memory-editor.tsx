'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgetAction, rememberAction } from '@/lib/actions';
import { dateTime, label } from '@/lib/format';
import type { Memory } from '@/lib/types';

export function MemoryEditor({ rows, canOrg }: { rows: Memory[]; canOrg: boolean }) {
  const [scope, setScope] = useState<'USER' | 'ORG'>('USER');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const res = await rememberAction(scope, key.trim(), value.trim());
      if (!res.ok) return void toast.error(res.error);
      toast.success('Remembered');
      setKey('');
      setValue('');
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await forgetAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Forgotten');
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <ul className="divide-y rounded-md border text-[13px]">
        {rows.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.scope === 'ORG' ? 'everyone' : 'me'}
                </span>
                <span className="code">{m.key}</span>
                <span className="text-[11px] text-muted-foreground">
                  {label(m.source)} · {dateTime(m.updatedAt)}
                </span>
              </div>
              <p className="mt-0.5">{m.value}</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label="Forget"
              disabled={pending}
              onClick={() => remove(m.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-muted-foreground">Nothing remembered yet.</li>
        ) : null}
      </ul>
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-[13px] font-semibold">Remember something</p>
        <div className="space-y-1">
          <Label>Applies to</Label>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-[13px]"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'USER' | 'ORG')}
          >
            <option value="USER">Just me</option>
            {canOrg ? <option value="ORG">Everyone</option> : null}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mkey">Key</Label>
          <Input
            id="mkey"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="digest.format"
            className="font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mval">What to remember</Label>
          <Input
            id="mval"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Say “recip”, not “recipient mare”."
          />
        </div>
        <Button size="sm" onClick={add} disabled={pending || !key.trim() || !value.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}

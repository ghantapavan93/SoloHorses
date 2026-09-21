'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { askMissingAction, confirmIntakeAction, rejectIntakeAction } from '@/lib/actions';
import { dateTime, label } from '@/lib/format';
import type { CustomerLite, IntakeParse, Message } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Inbox on the left, the selected text on the right with every parsed field editable.
 * Nothing is created until Confirm; the reply that carries the IDs is the confirmation.
 */
export function IntakeInbox({
  inbox,
  outbox,
  customers,
}: {
  inbox: Message[];
  outbox: Message[];
  customers: CustomerLite[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    inbox.find((m) => m.status === 'PARSED')?.id ?? inbox[0]?.id ?? null,
  );
  const selected = inbox.find((m) => m.id === selectedId) ?? null;
  const replies = selected ? outbox.filter((o) => o.toAddress === selected.fromAddress) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <ul className="max-h-[70vh] divide-y overflow-y-auto rounded-md border" aria-label="Inbox">
        {inbox.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => setSelectedId(m.id)}
              className={cn(
                'w-full space-y-1 px-3 py-2 text-left hover:bg-muted/60',
                selectedId === m.id && 'bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="code">{m.customer?.displayName ?? m.fromAddress}</span>
                <span>{dateTime(m.createdAt)}</span>
              </div>
              <p className="line-clamp-2 text-[13px]">{m.body}</p>
              <StatusPill tone={toneForStatus(m.status)}>{label(m.status)}</StatusPill>
            </button>
          </li>
        ))}
        {inbox.length === 0 ? (
          <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">No texts yet.</li>
        ) : null}
      </ul>
      {selected ? (
        <Detail key={selected.id} message={selected} replies={replies} customers={customers} />
      ) : (
        <div className="rounded-md border p-6 text-[13px] text-muted-foreground">Select a text.</div>
      )}
    </div>
  );
}

function Detail({ message, replies, customers }: { message: Message; replies: Message[]; customers: CustomerLite[] }) {
  const parsed: IntakeParse = message.parsed ?? {
    kind: 'UNKNOWN',
    sireName: null,
    damName: null,
    eventDate: null,
    embryoCount: null,
    storage: null,
    sendingVet: null,
    expectedArrival: null,
    missing: [],
    confidence: 0,
  };
  const [form, setForm] = useState({
    customerId: message.customerId ?? '',
    kind: parsed.kind,
    sireName: parsed.sireName ?? '',
    damName: parsed.damName ?? '',
    eventDate: parsed.eventDate ?? '',
    count: parsed.embryoCount ?? 1,
    sendingVet: parsed.sendingVet ?? '',
    storage: parsed.storage ?? '',
    expectedArrival: parsed.expectedArrival ?? '',
  });
  const [pending, start] = useTransition();
  const editable = message.status === 'PARSED' || message.status === 'RECEIVED';

  const confirm = () =>
    start(async () => {
      const res = await confirmIntakeAction(message.id, {
        customerId: form.customerId || undefined,
        kind: form.kind,
        sireName: form.sireName || null,
        damName: form.damName || null,
        eventDate: form.eventDate || null,
        count: Number(form.count),
        sendingVet: form.sendingVet || null,
        storage: form.storage || null,
        expectedArrival: form.expectedArrival || null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Confirmed · ${res.data.embryoIds.join(', ')}`, { description: res.data.reply });
    });

  const askMissing = () =>
    start(async () => {
      const res = await askMissingAction(message.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Asked for the missing fields', { description: res.data.reply });
    });

  const reject = () =>
    start(async () => {
      const reason = window.prompt('Why is this text being rejected?') ?? '';
      if (!reason) return;
      const res = await rejectIntakeAction(message.id, reason);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Rejected');
    });

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span>
            From <span className="code">{message.fromAddress}</span> · {dateTime(message.createdAt)}
          </span>
          <StatusPill tone={toneForStatus(message.status)}>{label(message.status)}</StatusPill>
        </div>
        <p className="rounded-sm bg-muted px-3 py-2 text-[13px]">{message.body}</p>
        {message.parsed ? (
          <p className="text-[11px] text-muted-foreground">
            Parsed with {Math.round(parsed.confidence * 100)}% of the fields this kind needs
            {parsed.missing.length > 0 ? ` · missing: ${parsed.missing.join(', ')}` : ''}. Deterministic parser, not a
            model — a person confirms.
          </p>
        ) : null}
        {message.parsed && parsed.stage && parsed.stage !== 'UNKNOWN' ? (
          <p className="text-[11px] text-muted-foreground">
            {parsed.stage === 'OVULATION' ? 'Ovulation notice' : 'Shipment notice'} — the vet texts on ovulation day and
            again on shipment day.
            {parsed.stage === 'OVULATION' && parsed.expectedFlushOn
              ? ` Flush expected around ${parsed.expectedFlushOn} (day 8; the shipment text sets the real arrival).`
              : ''}
          </p>
        ) : null}
      </div>

      {message.embryos && message.embryos.length > 0 ? (
        <p className="text-[13px]">
          Created:{' '}
          {message.embryos.map((e) => (
            <Link key={e.id} className="code mr-1 hover:underline" href={`/embryos/${e.id}`}>
              {e.id}
            </Link>
          ))}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Customer">
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-[13px]"
            value={form.customerId}
            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            disabled={!editable}
          >
            <option value="">— choose —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} · {c.id}
                {c.phone === message.fromAddress ? ' (matches phone)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-[13px]"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as IntakeParse['kind'] })}
            disabled={!editable}
          >
            {['ICSI', 'FLUSH', 'THAWED', 'UNKNOWN'].map((k) => (
              <option key={k} value={k}>
                {k === 'UNKNOWN' ? 'not stated' : k.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sire">
          <Input
            value={form.sireName}
            onChange={(e) => setForm({ ...form, sireName: e.target.value })}
            disabled={!editable}
          />
        </Field>
        <Field label="Dam">
          <Input
            value={form.damName}
            onChange={(e) => setForm({ ...form, damName: e.target.value })}
            disabled={!editable}
          />
        </Field>
        <Field label={form.kind === 'ICSI' ? 'ICSI date' : 'Ovulation / flush date'}>
          <Input
            type="date"
            value={form.eventDate}
            onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
            disabled={!editable}
          />
        </Field>
        <Field label="Embryos">
          <Input
            type="number"
            min={1}
            max={12}
            value={form.count}
            onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
            disabled={!editable}
          />
        </Field>
        <Field label="Sending vet">
          <Input
            value={form.sendingVet}
            onChange={(e) => setForm({ ...form, sendingVet: e.target.value })}
            disabled={!editable}
          />
        </Field>
        <Field label="Expected arrival">
          <Input
            value={form.expectedArrival}
            onChange={(e) => setForm({ ...form, expectedArrival: e.target.value })}
            disabled={!editable}
            placeholder="Tue by 1 PM"
          />
        </Field>
        {form.kind === 'THAWED' ? (
          <Field label="Storage">
            <Input
              value={form.storage}
              onChange={(e) => setForm({ ...form, storage: e.target.value })}
              disabled={!editable}
            />
          </Field>
        ) : null}
      </div>

      {editable ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={confirm} disabled={pending || !form.customerId}>
            {pending ? 'Working…' : 'Confirm and reply with IDs'}
          </Button>
          <Button size="sm" variant="outline" onClick={askMissing} disabled={pending}>
            Ask for missing fields
          </Button>
          <Button size="sm" variant="ghost" onClick={reject} disabled={pending}>
            Reject
          </Button>
        </div>
      ) : null}

      {replies.length > 0 ? (
        <div className="space-y-1">
          <p className="eyebrow">Replies to this number</p>
          <ul className="space-y-1">
            {replies.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-2 rounded-sm border px-3 py-1.5 text-[12px]"
              >
                <span>{r.body}</span>
                <span className="shrink-0 text-muted-foreground">
                  {label(r.status)} · {dateTime(r.sentAt ?? r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{text}</Label>
      {children}
    </div>
  );
}

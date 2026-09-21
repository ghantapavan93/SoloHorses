'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { recordCheckAction } from '@/lib/actions';

const RESULTS = [
  { value: 'HEARTBEAT', label: 'Heartbeat', hint: 'Day 24 — starts the lease fee and board' },
  { value: 'PREGNANT', label: 'Pregnant', hint: 'Positive, no heartbeat call' },
  { value: 'OPEN', label: 'Open', hint: 'Not pregnant — client owed a redo or credit' },
  { value: 'LOST', label: 'Lost', hint: 'Pregnancy lost after confirmation' },
  { value: 'UNCLEAR', label: 'Unclear', hint: 'Recheck required; nothing billed' },
] as const;

/** The vet records what the ultrasound showed. The rules decide what that means for money. */
export function RecordCheckDialog({
  transferId,
  embryoId,
  gestationDay,
  recipLabel,
}: {
  transferId: string;
  embryoId: string;
  gestationDay: number;
  recipLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<(typeof RESULTS)[number]['value']>(
    gestationDay >= 24 && gestationDay < 30 ? 'HEARTBEAT' : 'PREGNANT',
  );
  const [notes, setNotes] = useState('');
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await recordCheckAction(transferId, embryoId, {
        result,
        dayNumber: gestationDay,
        notes: notes || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const invoiced = res.data.invoices.length > 0 ? ` · invoiced ${res.data.invoices.join(', ')}` : '';
      toast.success(`${res.data.checkId} recorded${invoiced}`, { description: res.data.notes.join(' ') });
      setOpen(false);
      setNotes('');
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-[12px]">
          Record check
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Day {gestationDay} check · {recipLabel}
          </DialogTitle>
          <DialogDescription>
            <span className="code">{embryoId}</span>. Billing follows the result automatically and shows up in the audit
            trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            {RESULTS.map((r) => (
              <label
                key={r.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${result === r.value ? 'border-foreground' : ''}`}
              >
                <input
                  type="radio"
                  name="result"
                  value={r.value}
                  checked={result === r.value}
                  onChange={() => setResult(r.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-[12px] text-muted-foreground">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional. Never a billing trigger."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Recording…' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

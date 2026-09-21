'use client';

import { useState, useTransition } from 'react';
import { MessageSquarePlus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { simulateInboundAction } from '@/lib/actions';

const EXAMPLES = [
  'Cross: Reyzin Ironwood x Miss Tally, ICSI 4/14, 2 embryos, Tue by 1pm, Dr. Ortega',
  'sending 1 embryo hickory stylish x dusty clover ov 4/10 flushing weds arriving thurs am',
  'Frozen embryo Tin Cup Tuff x Royal Sage, tank 2 slot 7 at our clinic, want it in a recip end of April',
  'Two blasts coming from Blue Mesa Boonlight x Lena Juniper, Dr. Lindqvist, ICSI 4/13, fedex tomorrow',
  'STOP',
];

/** Same pipeline the carrier webhook feeds. Staff paste what a vet would text. */
export function SimulateInbound({ mode }: { mode: 'live' | 'simulated' }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('+15559990001');
  const [body, setBody] = useState(EXAMPLES[0] ?? '');
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await simulateInboundAction(from, body);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Received · ${res.data.classification.toLowerCase()}`);
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <MessageSquarePlus className="size-3.5" /> {mode === 'live' ? 'Simulate a text' : 'Text the line'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inbound text</DialogTitle>
          <DialogDescription>
            {mode === 'live'
              ? 'Twilio is configured; real texts arrive on the signed webhook. This form bypasses the carrier for demos.'
              : 'No carrier configured. This form stands in for the Twilio webhook and runs the same intake pipeline.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="from">From (a customer phone in the records, or any number)</Label>
            <Input id="from" value={from} onChange={(e) => setFrom(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setBody(e)}
                className="rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {e.length > 42 ? `${e.slice(0, 40)}…` : e}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !body.trim()}>
            {pending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

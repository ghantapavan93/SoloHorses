'use client';

import { useState, useTransition } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
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
import { armFaultsAction, reconcileNowAction, tamperBooksAction } from '@/lib/actions';

/** Reconcile now; and, with the simulator, break things on purpose to show the recovery. */
export function MoneyControls({ simulated, jobsMode }: { simulated: boolean; jobsMode: 'redis' | 'inline' }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState('');
  const [amount, setAmount] = useState('');
  const [faults, setFaults] = useState('429x2');

  const reconcile = () =>
    start(async () => {
      const res = await reconcileNowAction();
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        res.data.findings === 0 ? 'Reconciled — everything agrees.' : `Reconciled — ${res.data.findings} finding(s).`,
      );
    });

  const tamper = () =>
    start(async () => {
      const cents = Math.round(Number(amount) * 100);
      const res = await tamperBooksAction(
        doc.startsWith('PAY') ? 'PAYMENT' : 'INVOICE',
        doc.trim(),
        Number.isFinite(cents) && amount !== '' ? { totalCents: cents } : { unlink: true },
      );
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Books changed for ${doc}. Reconcile to see the discrepancy.`);
      setOpen(false);
    });

  const arm = () =>
    start(async () => {
      const res = await armFaultsAction(faults);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Faults armed: ${faults}`, {
        description:
          jobsMode === 'redis'
            ? 'Watch the sync log: 429s pause the queue, then it recovers.'
            : 'Inline mode retries with backoff in-process.',
      });
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={reconcile}>
        <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} /> Reconcile now
      </Button>
      {simulated ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
              <Wrench className="size-3.5" /> Break something
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Simulator controls</DialogTitle>
              <DialogDescription>
                Only available without a real sandbox. Produces the failures a real integration meets, so the recovery
                paths can be shown.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-[13px] font-medium">Change what the books say</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="doc">Invoice or payment code</Label>
                    <Input
                      id="doc"
                      placeholder="INV-26-0012"
                      value={doc}
                      onChange={(e) => setDoc(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="amt">New amount (USD), or blank to unlink</Label>
                    <Input id="amt" placeholder="5000.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                </div>
                <Button size="sm" onClick={tamper} disabled={pending || !doc.trim()}>
                  Tamper
                </Button>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-[13px] font-medium">Inject provider faults</p>
                <div className="space-y-1">
                  <Label htmlFor="faults">Spec</Label>
                  <Input id="faults" value={faults} onChange={(e) => setFaults(e.target.value)} className="font-mono" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  429x2 throttles the next two calls · 500x1 one transient error · stale:INV-… a stale SyncToken ·
                  dupname a duplicate customer name
                </p>
                <Button size="sm" variant="outline" onClick={arm} disabled={pending}>
                  Arm
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

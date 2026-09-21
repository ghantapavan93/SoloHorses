'use client';

import { useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostedLinkAction, manualPaymentAction, replayEventAction, simulatePaymentAction } from '@/lib/actions';
import type { Role } from '@/lib/types';

/**
 * Pay an open invoice. With Stripe keys this opens the hosted invoice (card or ACH, test
 * cards). Without them, the simulator runs the same webhook pipeline — and offers the
 * replay button that proves a duplicate delivery changes nothing.
 */
export function InvoiceActions({
  invoiceId,
  amountCents,
  role,
  revalidate,
}: {
  invoiceId: string;
  amountCents: number;
  role: Role;
  revalidate: string[];
}) {
  const [pending, start] = useTransition();
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const canWrite = role === 'BILLING' || role === 'ADMIN';

  const pay = () =>
    start(async () => {
      const res = await hostedLinkAction(invoiceId);
      if (!res.ok) return void toast.error(res.error);
      if (!res.data.simulated && res.data.hostedInvoiceUrl) {
        window.open(res.data.hostedInvoiceUrl, '_blank', 'noopener');
        toast.message('Stripe hosted invoice opened', {
          description: 'Use test card 4242 4242 4242 4242, or the ACH test account.',
        });
      } else {
        toast.message('Stripe is not configured here', {
          description: canWrite ? 'Use the simulator buttons instead.' : 'Ask billing to record the payment.',
        });
      }
    });

  const simulate = (outcome: 'succeeded' | 'processing' | 'failed', method: 'CARD' | 'ACH') =>
    start(async () => {
      const res = await simulatePaymentAction(invoiceId, outcome, method, revalidate);
      if (!res.ok) return void toast.error(res.error);
      setLastEvent(res.data.eventId);
      toast.success(`${res.data.eventId} · ${outcome} (${method.toLowerCase()})`, {
        description: res.data.mode === 'inline' ? 'Processed inline (no Redis).' : 'Queued on BullMQ.',
      });
    });

  const replay = () =>
    start(async () => {
      if (!lastEvent) return;
      const res = await replayEventAction(lastEvent, revalidate);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        res.data.duplicate
          ? 'Duplicate delivery ignored — one payment row, state unchanged.'
          : 'Processed (first delivery).',
      );
    });

  const manual = () =>
    start(async () => {
      const res = await manualPaymentAction(invoiceId, 'CHECK', amountCents, 'recorded at the office', revalidate);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.paymentId} recorded (check)`);
    });

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" disabled={pending} onClick={pay}>
        Pay <ExternalLink className="size-3" />
      </Button>
      {canWrite ? (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={pending}
            onClick={() => simulate('succeeded', 'CARD')}
          >
            Simulate card
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={pending}
            onClick={() => simulate('processing', 'ACH')}
          >
            Simulate ACH pending
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={pending}
            onClick={() => simulate('failed', 'CARD')}
          >
            Simulate decline
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[12px]" disabled={pending} onClick={manual}>
            Record check
          </Button>
          {lastEvent ? (
            <Button size="sm" variant="secondary" className="h-7 text-[12px]" disabled={pending} onClick={replay}>
              Replay {lastEvent}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

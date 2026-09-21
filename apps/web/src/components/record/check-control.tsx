'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recordCheckAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

type CheckResult = 'HEARTBEAT' | 'PREGNANT' | 'OPEN' | 'LOST' | 'UNCLEAR';

const RESULT_LABEL: Record<CheckResult, string> = {
  HEARTBEAT: 'heartbeat',
  PREGNANT: 'pregnant',
  OPEN: 'open',
  LOST: 'lost',
  UNCLEAR: 'unclear · recheck',
};

/**
 * The vet records what the ultrasound showed, in one row on the page where the exception
 * sits. The milestone rule decides what the result means for money and says so in the toast;
 * the overdue-check exception closes itself on the next sweep. On the public pages the demo
 * reviewer records as the vet would, and the audit row says so.
 */
export function CheckControl({
  transferId,
  embryoId,
  gestationDay,
  label = 'Record the check',
  className,
}: {
  transferId: string;
  embryoId: string;
  gestationDay: number;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // A heartbeat is a day-24 call; past day 30 the choices are what a later scan can show.
  const results: CheckResult[] =
    gestationDay < 30 ? ['HEARTBEAT', 'PREGNANT', 'OPEN', 'UNCLEAR'] : ['PREGNANT', 'OPEN', 'LOST', 'UNCLEAR'];
  const [result, setResult] = useState<CheckResult>(results[0] ?? 'PREGNANT');
  const record = () =>
    start(async () => {
      const res = await recordCheckAction(transferId, embryoId, { result, dayNumber: gestationDay, notes: null }, true);
      if (res.ok) {
        const invoiced = res.data.invoices.length > 0 ? `Invoiced ${res.data.invoices.join(', ')}.` : 'Nothing billed.';
        toast.success(`${res.data.checkId} recorded: ${RESULT_LABEL[result]} at day ${gestationDay}. ${invoiced}`, {
          description: res.data.notes.join(' '),
        });
      } else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
      router.refresh();
    });
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <Stethoscope className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="text-[12px]">day {gestationDay} check</span>
      <select
        aria-label="Check result"
        className="h-7 rounded-md border bg-background px-1.5 text-[12px]"
        value={result}
        onChange={(e) => setResult(e.target.value as CheckResult)}
        disabled={pending}
      >
        {results.map((r) => (
          <option key={r} value={r}>
            {RESULT_LABEL[r]}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[12px]"
        disabled={pending}
        onClick={record}
        data-testid="record-check"
      >
        {label}{' '}
        <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider">
          as the vet
        </span>
      </Button>
    </span>
  );
}

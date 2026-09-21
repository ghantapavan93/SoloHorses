'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recordClearanceAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

export type ClearanceKind =
  'COGGINS' | 'UTERINE_CULTURE' | 'UTERINE_CYTOLOGY' | 'PRE_TRANSFER_EXAM' | 'VIDEO_IN_FOAL' | 'RETURN_ASSESSMENT';
export type ClearanceResult = 'CLEAR' | 'ABNORMAL' | 'PENDING';

const KIND_LABEL: Record<ClearanceKind, string> = {
  PRE_TRANSFER_EXAM: 'pre-transfer exam',
  UTERINE_CULTURE: 'uterine culture',
  UTERINE_CYTOLOGY: 'uterine cytology',
  COGGINS: 'Coggins',
  VIDEO_IN_FOAL: 'video confirmation in foal',
  RETURN_ASSESSMENT: 'return assessment',
};

const RESULT_LABEL: Record<ClearanceResult, string> = { CLEAR: 'clear', ABNORMAL: 'abnormal', PENDING: 'pending' };

/**
 * The vet's word on a mare, in one row: what was done, what it found, record. The rules read
 * the row on the next sweep — nothing here clears a transfer, lets a mare leave or decides a
 * fee. On the public pages the demo reviewer records as the vet would; the audit row says so.
 */
export function ClearanceControl({
  horseId,
  kinds,
  defaultKind,
  results = ['CLEAR', 'ABNORMAL', 'PENDING'],
  label = 'Record',
  done,
  className,
  allowReviewer = true,
}: {
  horseId: string;
  kinds: ClearanceKind[];
  defaultKind?: ClearanceKind;
  results?: ClearanceResult[];
  label?: string;
  done?: string;
  className?: string;
  allowReviewer?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<ClearanceKind>(defaultKind ?? kinds[0] ?? 'PRE_TRANSFER_EXAM');
  const [result, setResult] = useState<ClearanceResult>(results[0] ?? 'CLEAR');
  const record = () =>
    start(async () => {
      const res = await recordClearanceAction(horseId, kind, result, null, allowReviewer);
      if (res.ok)
        toast.success(
          done ?? `${KIND_LABEL[kind]} recorded: ${RESULT_LABEL[result]}. The rules read it on the next sweep.`,
        );
      else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
      router.refresh();
    });
  const select = 'h-7 rounded-md border bg-background px-1.5 text-[12px]';
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <Stethoscope className="size-3.5 text-muted-foreground" aria-hidden />
      {kinds.length > 1 ? (
        <select
          aria-label="Clearance"
          className={select}
          value={kind}
          onChange={(e) => setKind(e.target.value as ClearanceKind)}
          disabled={pending}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[12px]">{KIND_LABEL[kind]}</span>
      )}
      {results.length > 1 ? (
        <select
          aria-label="Result"
          className={select}
          value={result}
          onChange={(e) => setResult(e.target.value as ClearanceResult)}
          disabled={pending}
        >
          {results.map((r) => (
            <option key={r} value={r}>
              {RESULT_LABEL[r]}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[12px]"
        disabled={pending}
        onClick={record}
        data-testid={`record-${kind.toLowerCase()}`}
      >
        {label}{' '}
        <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider">
          as the vet
        </span>
      </Button>
    </span>
  );
}

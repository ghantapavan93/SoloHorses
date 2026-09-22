import { cn } from '@/lib/utils';

export type Tone = 'ok' | 'warn' | 'critical' | 'neutral' | 'brand';

const TONES: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  critical: 'border-critical/30 bg-critical/10 text-critical',
  neutral: 'border-border bg-muted text-muted-foreground',
  brand: 'border-brand/30 bg-brand-tint text-brand',
};

/** Status is a word in a quiet pill. Four tones, never the brand accent. */
export function StatusPill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function toneForStatus(status: string): Tone {
  const s = status.toUpperCase();
  if (
    [
      'SHIPPABLE',
      'PAID',
      'SUCCEEDED',
      'SYNCED',
      'CONFIRMED',
      'SENT',
      'PREGNANT',
      'HEARTBEAT',
      'SCHEDULED',
      'ARRIVED',
      'RESULTED',
      'PROCESSED',
    ].includes(s)
  )
    return 'ok';
  if (
    [
      'HOLD_UNPAID',
      'PROCESSING',
      'PENDING',
      'PARSED',
      'QUEUED',
      'OPEN',
      'IN_PROGRESS',
      'EXPECTED',
      'IN_TRANSIT',
      'DEPOSIT_PAID',
      'SIGNED',
      'PAID_IN_FULL',
      'RESERVED',
      'MISMATCH',
      'UNCLEAR',
      'RECEIVED',
      'UNKNOWN',
    ].includes(s)
  )
    return 'warn';
  if (['FAILED', 'LOST', 'REJECTED', 'CANCELLED', 'ORPHANED', 'VOID', 'REFUNDED'].includes(s)) return 'critical';
  return 'neutral';
}

'use client';

import { useTransition } from 'react';
import { Mail, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { sendDigestAction } from '@/lib/actions';
import type { DigestPreview } from '@/lib/types';

/**
 * The owner update that used to be a hand-built list pasted into a group text.
 * Generated from the records, previewed before it goes, one line per embryo.
 */
export function DigestPanel({ preview, canSend }: { preview: DigestPreview; canSend: boolean }) {
  const [pending, start] = useTransition();
  const send = (channels: ('SMS' | 'EMAIL')[]) =>
    start(async () => {
      const res = await sendDigestAction(preview.customer.id, channels);
      if (!res.ok) return void toast.error(res.error);
      const parts = [];
      if (res.data.queued.length > 0) parts.push(`${res.data.queued.length} queued`);
      if (res.data.skipped.length > 0)
        parts.push(`skipped ${res.data.skipped.join(', ').toLowerCase()} (no address or opted out)`);
      toast.success('Digest sent', { description: parts.join(' · ') });
    });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Owner update</h2>
        <span className="text-[11px] text-muted-foreground">
          {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'}
        </span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono text-[11px] leading-relaxed">
        {preview.sms}
      </pre>
      {canSend ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[12px]"
            disabled={pending || !preview.customer.phone || preview.customer.smsOptedOut}
            onClick={() => send(['SMS'])}
          >
            <MessageSquareText className="size-3" /> Text
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[12px]"
            disabled={pending || !preview.customer.email}
            onClick={() => send(['EMAIL'])}
          >
            <Mail className="size-3" /> Email
          </Button>
          <Button size="sm" className="h-7 text-[12px]" disabled={pending} onClick={() => send(['SMS', 'EMAIL'])}>
            Send both
          </Button>
        </div>
      ) : null}
      {preview.customer.smsOptedOut ? (
        <p className="text-[11px] text-warn">
          This number replied STOP; texts are off until the office re-enables them.
        </p>
      ) : null}
    </div>
  );
}

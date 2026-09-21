'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { closeRequestAction } from '@/lib/actions';

/** A person marks a team request done. The row keeps its words; the audit line keeps who did it. */
export function RequestDone({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2 h-7 text-[12px]"
      disabled={pending}
      data-testid={`request-done-${id}`}
      onClick={() =>
        start(async () => {
          const note = window.prompt('Done — what happened? (goes in the audit trail; optional)') ?? '';
          const res = await closeRequestAction(id, note.length > 0 ? note : null);
          if (res.ok) toast.success('Marked done.');
          else toast.error(res.error);
        })
      }
    >
      <Check className="mr-1 size-3" /> Mark done
    </Button>
  );
}

'use client';

import { useTransition } from 'react';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runEvalsAction } from '@/lib/actions';

/** Starts the suite; the run fills in on this page as cases are graded. On a metered model it spends real tokens, so it says so. */
export function EvalControls({ live, cases }: { live: boolean; cases: number }) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await runEvalsAction();
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        `Run started · ${res.data.total} cases on ${res.data.model}. This page fills in as they are graded; refresh to follow.`,
      );
    });
  return (
    <Button
      size="sm"
      className="gap-1.5"
      disabled={pending}
      onClick={run}
      title={
        live
          ? `Starts ${cases} cases against the model that answers Ask`
          : `Starts ${cases} cases against the deterministic answerer — the same gate, tools, graph and verifier; the run is labelled offline`
      }
    >
      <Play className="size-3.5" /> {pending ? 'Starting…' : `Run ${cases} cases`}
    </Button>
  );
}

import type { AskAuthority, AskEvent, AskLastRun } from '@/lib/types';

/**
 * What the boundary diagram draws for one run: the tools reached for in order, the strand the
 * gate held on, and where the one gated action stands. Pure data, usable on the server (the
 * landing draws the last real run) and in the browser (the panel plays a live one).
 */
export interface MembraneRun {
  steps: { seq: number; tool: string; ok: boolean; durationMs?: number }[];
  /** The refused capability's key when the gate held this run, else null. */
  refused: string | null;
  proposal: 'NONE' | 'PROPOSED' | 'APPROVED' | 'DECLINED';
}

/** The last real run, in the shape the diagram draws. */
export function runFromLast(last: AskLastRun | null): MembraneRun | null {
  if (!last) return null;
  return { steps: last.steps, refused: last.refused, proposal: last.proposal };
}

/** Folds one turn's streamed events into the run the diagram draws; the catalog's refusal texts identify which strand held. */
export function foldEvent(
  run: MembraneRun | null,
  event: AskEvent | { type: 'start'; question: string },
  catalog: AskAuthority,
): MembraneRun | null {
  if (event.type === 'start') return { steps: [], refused: null, proposal: 'NONE' };
  const current = run ?? { steps: [], refused: null, proposal: 'NONE' as const };
  if (event.type === 'tool')
    return {
      ...current,
      steps: [
        ...current.steps,
        { seq: current.steps.length + 1, tool: event.name, ok: event.ok, durationMs: event.durationMs },
      ],
    };
  if (event.type === 'answer') {
    const refused =
      catalog.refused.find((c) => event.answer.abstentions.some((a) => a.detail === c.detail))?.key ?? null;
    return { ...current, refused, proposal: event.proposals?.length ? 'PROPOSED' : current.proposal };
  }
  return current;
}

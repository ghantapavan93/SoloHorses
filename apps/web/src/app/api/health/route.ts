import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Where the estate is, for a browser that just arrived: three answers from two probes of the
 * API's own health contract, never a guess from one failed business read.
 *
 *   waking   — /health/live does not answer: the free instance is starting, or gone.
 *   loading  — the process is up but /health/ready says not yet: the database is waking, the
 *              schema migrating, the world seeding.
 *   ready    — operational traffic may be served; the page reads its records again.
 *
 * Liveness needs no token and no database, so the browser may ask every few seconds while
 * it waits without keeping a database that suspends when idle awake.
 */
export type HealthPhase = 'waking' | 'loading' | 'ready';

export async function GET(): Promise<Response> {
  const base = env.API_URL;
  let live = false;
  let uptimeSec: number | null = null;
  try {
    const response = await fetch(`${base}/health/live`, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; uptimeSec?: number };
    live = response.ok && body.ok === true;
    uptimeSec = body.uptimeSec ?? null;
  } catch {
    live = false;
  }
  if (!live) return Response.json({ phase: 'waking' satisfies HealthPhase, live, ready: false, uptimeSec });

  let ready = false;
  let checks: Record<string, { ok: boolean; note: string }> | null = null;
  try {
    const response = await fetch(`${base}/health/ready`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      checks?: Record<string, { ok: boolean; note: string }>;
    };
    ready = response.ok && body.ok === true;
    checks = body.checks ?? null;
  } catch {
    ready = false;
  }
  return Response.json({ phase: (ready ? 'ready' : 'loading') satisfies HealthPhase, live, ready, uptimeSec, checks });
}

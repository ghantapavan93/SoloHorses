import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Is the estate awake? The browser asks this while a page shows "waking", and once it says yes
 * the page refreshes itself. Liveness only — no token, no database — the same probe the hosting
 * platform uses, answered in a few milliseconds when the API is up and refused in a few when it
 * is not.
 */
export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${env.API_URL}/health/live`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; uptimeSec?: number };
    return Response.json({ ok: response.ok && body.ok === true, uptimeSec: body.uptimeSec ?? null });
  } catch {
    return Response.json({ ok: false, uptimeSec: null });
  }
}

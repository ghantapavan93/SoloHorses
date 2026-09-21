import { apiToken } from '@/lib/api';
import { env } from '@/lib/env';

/**
 * Proxies the platform's live feed (jobs, events, breakers, exceptions) to the browser with
 * the session's identity. When the API is down the answer is a quiet 503 with a retry hint —
 * EventSource backs off and reconnects on its own; nothing here becomes a stack trace.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await apiToken({ allowReviewer: true });
  const replay = new URL(request.url).searchParams.get('replay') ?? '0';
  let upstream: Response;
  try {
    upstream = await fetch(`${env.API_URL}/platform/stream?replay=${encodeURIComponent(replay)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return new Response('stream unavailable', {
      status: 503,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('stream unavailable', {
      status: upstream.status >= 500 ? 503 : upstream.status,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

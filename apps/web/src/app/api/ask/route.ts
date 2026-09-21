import { apiToken } from '@/lib/api';
import { env } from '@/lib/env';

/** Proxies the API's server-sent events to the browser with the session's identity. */
export async function POST(request: Request): Promise<Response> {
  const token = await apiToken({ allowReviewer: true });
  const body = await request.text();
  const upstream = await fetch(`${env.API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    body,
    cache: 'no-store',
    // @ts-expect-error -- Node fetch supports duplex for streaming request bodies
    duplex: 'half',
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || 'Ask failed', { status: upstream.status });
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

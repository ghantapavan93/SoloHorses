import type { AskEvent } from '@/lib/types';

/**
 * One question over the wire, event by event: the tools as they run, then the answer. The
 * same call for the dock, the story page and the front door; the browser never holds a token —
 * the route handler signs the request with the session (or the demo reviewer).
 */
export async function streamAsk(
  input: {
    question: string;
    conversationId: string | null;
    context: { path: string | null; entityId: string | null } | null;
  },
  onEvent: (event: AskEvent) => void,
): Promise<void> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error('Your session is stale (the demo world was rebuilt). Sign out and back in.');
  if (!res.ok || !res.body) throw new Error(`Ask failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (dataLine) onEvent(JSON.parse(dataLine.slice(6)) as AskEvent);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

import type { Signal } from './types';

/**
 * Where a signal's next step lives. The API names a surface; the page knows the URL and
 * whether a session exists. Public surfaces open directly; the application shell asks for
 * a role first, and the login page is one click per role.
 */
export function hrefForSignal(signal: Signal, signedIn: boolean): string {
  const { path, gated } = surfaceFor(signal);
  return gated && !signedIn ? gate(path) : path;
}

/**
 * The same door with the signal's question in hand: the page's own assistant (`/story`,
 * `/settlement`) or the shell's palette reads `?ask=` and asks it once. A gated surface is
 * gated as a whole, question included, so the login page can send the person on to it.
 */
export function askHrefForSignal(signal: Signal, signedIn: boolean): string {
  const { path, gated } = surfaceFor(signal);
  const [bare, hash] = path.split('#');
  const withQuestion = `${bare}${bare.includes('?') ? '&' : '?'}ask=${encodeURIComponent(askForSignal(signal))}${hash ? `#${hash}` : ''}`;
  return gated && !signedIn ? gate(withQuestion) : withQuestion;
}

const gate = (path: string) => `/login?next=${encodeURIComponent(path)}`;

/** Where a signal's next step lives, and whether the shell asks for a role first. */
function surfaceFor(signal: Signal): { path: string; gated: boolean } {
  switch (signal.surface) {
    case 'settlement':
      return { path: '/settlement', gated: false };
    case 'returns':
      return { path: '/settlement#returns', gated: false };
    case 'story':
      return { path: '/story', gated: false };
    case 'money':
      return {
        path: signal.entityId && /^(INV|PAY)-/.test(signal.entityId) ? `/money?focus=${signal.entityId}` : '/money',
        gated: true,
      };
    case 'intake':
      return { path: '/intake', gated: true };
    default:
      return { path: '/operations', gated: true };
  }
}

/** The question the assistant answers about a signal, in the office's words. */
export function askForSignal(signal: Signal): string {
  switch (signal.kind) {
    case 'PAPERS_HELD':
      return `Why are the papers for ${signal.lotId ?? 'the sold lot'} held?`;
    case 'SETTLEMENT_CONFLICT':
      return `Which source is right about the settlement of ${signal.lotId ?? 'the sold lot'}?`;
    case 'RETURN_ASSESSMENT_MISSING':
    case 'RETURN_FEE_DECISION':
      return 'Can we decide the $6,000 recipient fee now?';
    case 'DEPARTURE_UNCONFIRMED':
    case 'CHECK_OVERDUE':
    case 'RECIPIENT_CONFLICT':
      return `What could derail ${signal.entityId ?? 'her'}'s cycle right now?`;
    case 'ACCOUNTING_SYNC_FAILED':
    case 'RECONCILIATION_MISMATCH':
      return signal.entityId ? `What happened with ${signal.entityId}?` : 'Is the QuickBooks sync working?';
    default:
      return signal.entityId ? `Tell me about ${signal.entityId}` : 'What needs attention right now?';
  }
}

import 'server-only';
import { SignJWT } from 'jose';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { env } from './env';

/**
 * Server-side client for the API. Every call mints a two-minute HS256 token from the
 * session — the same identity the user signed in with — so the API enforces RBAC on the
 * real actor, never on a shared service account.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** The id the API stamped on its side; quote it and support can find the whole trace. */
    readonly correlationId: string | null = null,
  ) {
    super(message);
  }
}

/** One id per unit of work on the web side; the API adopts it and threads it through jobs and audit rows. */
export function newCorrelationId(): string {
  return `web_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const secret = new TextEncoder().encode(env.AUTH_SECRET);

/**
 * The identity the public front door reads as when nobody is signed in. Seeded with a fixed
 * id (packages/db/prisma/seed.ts); synthetic data only. Pages behind the app shell never use
 * it — only the story page, the honesty page and the routes they call.
 */
export const REVIEWER_USER_ID = 'usr_demo_reviewer';

export async function apiToken(options: { allowReviewer?: boolean } = {}): Promise<string> {
  const session = await auth();
  const identity = session?.user?.id
    ? { id: session.user.id, role: session.user.role, customerId: session.user.customerId }
    : options.allowReviewer
      ? { id: REVIEWER_USER_ID, role: 'ADMIN' as const, customerId: null }
      : null;
  if (!identity) redirect('/login');
  return new SignJWT({ role: identity.role, customerId: identity.customerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.id)
    .setIssuer('daysheet-web')
    .setAudience('daysheet-api')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(secret);
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; correlationId?: string; allowReviewer?: boolean } = {},
): Promise<T> {
  const token = await apiToken({ allowReviewer: init.allowReviewer });
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('x-correlation-id', init.correlationId ?? newCorrelationId());
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string | string[];
      details?: unknown;
      correlationId?: string | null;
    };
    const message = Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? response.statusText);
    throw new ApiError(
      response.status,
      body.code ?? 'ERROR',
      message,
      body.details,
      body.correlationId ?? response.headers.get('x-correlation-id'),
    );
  }
  if (response.status === 204) return undefined as T;
  // Nest sends an empty body for a handler that returns null (the last Ask run on a fresh world,
  // for one); an empty body is "nothing", never a parse error that takes the page down.
  const text = await response.text();
  return (text.length === 0 ? null : (JSON.parse(text) as unknown)) as T;
}

/** Same as apiFetch but returns null on 403/404 so pages can render a quiet empty state. */
/**
 * A read a page can live without: nothing to show is a state the page renders, not a crash.
 * Denied, missing, an API that is restarting or a gateway between here and it all come back
 * as null; a 500 is a bug and still throws, so it is seen.
 */
export async function apiFetchOrNull<T>(path: string, init: { allowReviewer?: boolean } = {}): Promise<T | null> {
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError) {
      if (
        error.status === 403 ||
        error.status === 404 ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 504
      )
        return null;
      throw error;
    }
    // undici's "fetch failed": the API is not listening yet, or not at all.
    if (error instanceof TypeError) return null;
    throw error;
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT verification with Node's crypto — no dependency, no algorithm
 * confusion (only HS256 is accepted), constant-time signature comparison.
 * The token is minted by the web server from the user's session and lives two minutes.
 */

export interface VerifiedClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat?: number;
  [claim: string]: unknown;
}

export class JwtVerifyError extends Error {}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifyHs256(
  token: string,
  secret: string,
  expected: { issuer: string; audience: string },
  now = Date.now(),
): VerifiedClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtVerifyError('malformed token');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string };
  } catch {
    throw new JwtVerifyError('malformed header');
  }
  if (header.alg !== 'HS256') throw new JwtVerifyError('unsupported algorithm');

  const expectedSignature = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const actualSignature = base64UrlDecode(signatureB64);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new JwtVerifyError('bad signature');
  }

  let claims: VerifiedClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as VerifiedClaims;
  } catch {
    throw new JwtVerifyError('malformed payload');
  }
  if (typeof claims.sub !== 'string' || !claims.sub) throw new JwtVerifyError('missing subject');
  if (claims.iss !== expected.issuer) throw new JwtVerifyError('wrong issuer');
  if (claims.aud !== expected.audience) throw new JwtVerifyError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new JwtVerifyError('expired');
  return claims;
}

/** Used by tests and the dev-token script; the web app signs with jose. Same wire format. */
export function signHs256(claims: Record<string, unknown>, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = base64UrlEncode(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

import { JwtVerifyError, signHs256, verifyHs256 } from './hs256';

const secret = 'a-test-secret-that-is-long-enough';
const now = 1_760_000_000_000;
const base = {
  sub: 'user_1',
  role: 'VET',
  customerId: null,
  iss: 'daysheet-web',
  aud: 'daysheet-api',
  iat: now / 1000,
  exp: now / 1000 + 120,
};

describe('verifyHs256', () => {
  it('round-trips a valid token', () => {
    const token = signHs256(base, secret);
    const claims = verifyHs256(token, secret, { issuer: 'daysheet-web', audience: 'daysheet-api' }, now);
    expect(claims.sub).toBe('user_1');
    expect(claims['role']).toBe('VET');
  });
  it('rejects a tampered payload', () => {
    const token = signHs256(base, secret);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...base, role: 'ADMIN' })).toString('base64url')}.${s}`;
    expect(() => verifyHs256(forged, secret, { issuer: 'daysheet-web', audience: 'daysheet-api' }, now)).toThrow(
      JwtVerifyError,
    );
  });
  it('rejects the wrong secret, audience, issuer, and expiry', () => {
    const token = signHs256(base, secret);
    expect(() =>
      verifyHs256(token, 'other-secret-also-long-enough', { issuer: 'daysheet-web', audience: 'daysheet-api' }, now),
    ).toThrow(/signature/);
    expect(() => verifyHs256(token, secret, { issuer: 'someone-else', audience: 'daysheet-api' }, now)).toThrow(
      /issuer/,
    );
    expect(() => verifyHs256(token, secret, { issuer: 'daysheet-web', audience: 'other' }, now)).toThrow(/audience/);
    expect(() =>
      verifyHs256(token, secret, { issuer: 'daysheet-web', audience: 'daysheet-api' }, now + 121_000),
    ).toThrow(/expired/);
  });
  it('refuses any algorithm other than HS256', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(base)).toString('base64url');
    expect(() =>
      verifyHs256(`${header}.${payload}.`, secret, { issuer: 'daysheet-web', audience: 'daysheet-api' }, now),
    ).toThrow(/algorithm/);
  });
});

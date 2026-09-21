import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// One .env at the repo root serves every workspace app; Next only reads its own directory.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

/**
 * Headers every response carries. The content-security-policy is deliberately the part that
 * cannot break the app — framing, plugins and base-uri — rather than a script policy shipped
 * untested the night before; the API has its own (helmet). Browser source maps stay off.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  headers: () => Promise.resolve([{ source: '/(.*)', headers: SECURITY_HEADERS }]),
  // The dev-tools badge sits in every screenshot and GIF recorded against `pnpm dev`; the console still reports.
  devIndicators: false,
  transpilePackages: ['@daysheet/domain'],
  // Server-only packages must not be bundled into route handlers.
  serverExternalPackages: ['jose'],
};

export default nextConfig;

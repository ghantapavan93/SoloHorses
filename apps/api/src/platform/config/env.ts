import { z } from 'zod';

/**
 * Environment is validated once at boot. Missing integration keys are allowed — each
 * integration falls back to a clearly labeled simulator — but a malformed value fails fast.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('Daysheet'),
  API_PORT: z.coerce.number().int().positive().default(3101),
  WEB_URL: z.string().url().default('http://localhost:3100'),
  /** The public base URL Twilio signs requests against (ngrok/Vercel); unset locally. */
  API_URL_PUBLIC: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  /** Empty means one process and no Redis: jobs run inline from the ledger, cache and rate limits in memory. */
  REDIS_URL: z.string().optional().default(''),
  /** One image, two roles: `api` serves HTTP and, by default, runs the workers too; `worker` runs only the workers. */
  WORKERS: z.enum(['on', 'off']).default('on'),
  /** Behind a platform's proxy (Render, Fly, a load balancer) the client's address is in X-Forwarded-For; the rate limits key on it. Off when the API faces its callers directly. */
  TRUST_PROXY: z.enum(['on', 'off']).default('off'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_JUDGE_MODEL: z.string().default('claude-haiku-4-5'),
  ASK_MONTHLY_SPEND_CAP_CENTS: z.coerce.number().int().nonnegative().default(3000),
  /**
   * Which model answers Ask. `auto`: the Anthropic key when set, else a local Ollama server
   * when one is reachable with a tool-capable model, else the deterministic offline answerer.
   * Tests never reach for Ollama unless asked, so a laptop with a model does not change a spec.
   */
  ASK_PROVIDER: z.enum(['auto', 'anthropic', 'openai', 'ollama', 'offline']).default('auto'),
  /** A hosted model behind an OpenAI-style endpoint (Groq, OpenRouter, Google's compatibility endpoint, Ollama's own /v1); `auto` prefers it over the local model when a key is set. */
  OPENAI_COMPAT_BASE_URL: z.string().optional().default(''),
  OPENAI_COMPAT_API_KEY: z.string().optional().default(''),
  OPENAI_COMPAT_MODEL: z.string().optional().default(''),
  OLLAMA_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b-instruct'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  /** One model turn may take this long; past it the deterministic composer answers and the run says so. */
  ASK_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),

  QBO_CLIENT_ID: z.string().optional().default(''),
  QBO_CLIENT_SECRET: z.string().optional().default(''),
  QBO_REDIRECT_URI: z.string().default('http://localhost:3101/integrations/qbo/callback'),
  QBO_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  QBO_SIM_FAULTS: z.string().optional().default(''),

  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM_NUMBER: z.string().optional().default(''),
  TWILIO_INTAKE_NUMBER: z.string().optional().default(''),

  RESEND_API_KEY: z.string().optional().default(''),
  DIGEST_FROM_EMAIL: z.string().default('daysheet@example.com'),

  SENTRY_DSN: z.string().optional().default(''),
  DEMO_CLOCK: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(''))
    .default(''),
  /** The Reliability Lab is on outside production; set to true to allow it there (never against real books). */
  LAB_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SEED: z.coerce.number().int().default(20260916),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}

/** Which integrations are live vs simulated — surfaced in /health and in the UI banner. */
export function integrationModes(
  env: Env,
): Record<'stripe' | 'qbo' | 'twilio' | 'resend' | 'anthropic', 'live' | 'simulated'> {
  const live = (v: string): 'live' | 'simulated' => (v.length > 0 ? 'live' : 'simulated');
  return {
    stripe: live(env.STRIPE_SECRET_KEY),
    qbo: live(env.QBO_CLIENT_ID),
    twilio: live(env.TWILIO_ACCOUNT_SID),
    resend: live(env.RESEND_API_KEY),
    anthropic: live(env.ANTHROPIC_API_KEY),
  };
}

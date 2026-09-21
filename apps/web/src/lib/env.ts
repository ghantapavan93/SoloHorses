import { z } from 'zod';

/** Server-only environment for the web app. Validated at first import. */
const Schema = z.object({
  API_URL: z.string().url().default('http://127.0.0.1:3101'),
  AUTH_SECRET: z.string().min(16),
  APP_NAME: z.string().default('Daysheet'),
});

export const env = Schema.parse({
  API_URL: process.env.API_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  APP_NAME: process.env.APP_NAME,
});

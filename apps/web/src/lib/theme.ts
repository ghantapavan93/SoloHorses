import { cookies } from 'next/headers';

export type Theme = 'dark' | 'light';

/**
 * Dark is the default: the front door and the shell read as one quiet, near-black surface.
 * Light stays one click away for the office at six in the morning next to printed contracts.
 * The choice is a cookie so the server renders the right class and nothing flashes.
 */
export const THEME_COOKIE = 'daysheet.theme';

export async function currentTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === 'light' ? 'light' : 'dark';
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The product film's manifest, written by `scripts/film.mjs` beside the recording it made:
 * a real screen recording of this build's own golden journey, with the moment each beat
 * began. The page reads it at request time; when there is no recording, the page says so.
 */
export interface FilmManifest {
  /** Paths under /public. */
  file: string;
  poster: string | null;
  /** The beats as WebVTT: the same words as the on-screen chip, for a reader. */
  captions: string | null;
  recordedAt: string;
  commit: string | null;
  durationSec: number;
  width: number;
  height: number;
  beats: { at: number; label: string }[];
}

export function readFilm(): FilmManifest | null {
  const dir = join(process.cwd(), 'public');
  const manifest = join(dir, 'film', 'journey.json');
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as FilmManifest;
    if (!existsSync(join(dir, parsed.file))) return null;
    const present = (path: string | null | undefined) => (path && existsSync(join(dir, path)) ? path : null);
    return { ...parsed, poster: present(parsed.poster), captions: present(parsed.captions) };
  } catch {
    return null;
  }
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { FilmManifest } from '@/lib/film';
import { cn } from '@/lib/utils';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The film and its beats. The recording is the build driving itself — nothing in it is
 * staged — and each beat is a moment in it: click one and the film goes there. The beat the
 * film is on is the only thing that moves, because it is the only thing that changes.
 */
export function FilmPlayer({ film }: { film: FilmManifest }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  // The poster's play button covers the native controls only until the first play; after that the controls are the person's.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onPlay = () => setStarted(true);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
    };
  }, []);
  const current = [...film.beats].reverse().find((b) => b.at <= time + 0.25) ?? null;
  const seek = (at: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = at;
    void el.play();
  };
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(240px,0.6fr)]" data-testid="film">
      <div className="relative overflow-hidden rounded-xl border border-white/[0.1] bg-black">
        {/* The beats beside the film are its captions; the recording has no speech. */}
        <video
          ref={video}
          className="aspect-video w-full"
          controls
          preload="metadata"
          poster={film.poster ? `/${film.poster}` : undefined}
          playsInline
          width={film.width}
          height={film.height}
        >
          <source src={`/${film.file}`} type="video/webm" />
          {film.captions ? <track kind="captions" src={`/${film.captions}`} srcLang="en" label="The beats" /> : null}
        </video>
        {!started ? (
          <button
            type="button"
            onClick={() => void video.current?.play()}
            className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/15 focus-visible:outline-none"
            aria-label="Play the film"
          >
            <span className="inline-flex size-16 items-center justify-center rounded-full border border-white/30 bg-[rgb(15_12_10/0.75)] text-paper shadow-[0_20px_40px_rgb(0_0_0/0.5)]">
              <Play className="ml-1 size-6" />
            </span>
          </button>
        ) : null}
      </div>
      <ol className="card-op self-start divide-y divide-white/[0.06]" aria-label="The beats of the film">
        {film.beats.map((beat) => {
          const on = current?.at === beat.at;
          return (
            <li key={beat.at}>
              <button
                type="button"
                onClick={() => seek(beat.at)}
                className={cn(
                  'flex w-full items-baseline gap-3 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.04]',
                  on ? 'text-paper' : 'text-muted-foreground',
                )}
                aria-current={on ? 'true' : undefined}
              >
                <span className="code w-8 shrink-0 tabular-nums text-[11px]">{clock(beat.at)}</span>
                <span className="min-w-0 flex-1 leading-snug">{beat.label}</span>
              </button>
            </li>
          );
        })}
        <li className="px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
          {clock(film.durationSec)} · recorded {film.recordedAt.slice(0, 10)} from this build
          {film.commit ? (
            <>
              {' '}
              · <span className="code">{film.commit.slice(0, 7)}</span>
            </>
          ) : null}{' '}
          · no narration, nothing staged
        </li>
      </ol>
    </div>
  );
}

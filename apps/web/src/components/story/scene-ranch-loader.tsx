'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { OperationsSummary, Xray } from '@/lib/types';

/**
 * The threshold scene is client-only: its positions come from the viewport and its motion from
 * the scroll, so the server sends the closed door and the words, and the scene takes over once
 * the script arrives. The words are the same on both sides, so nothing jumps. Where WebGL is
 * there, the built scene runs; where it is not, the drawn one — the same story, the same
 * records, one horse.
 */
const SceneRanch3D = dynamic(() => import('@/components/story/ranch/scene-ranch-3d').then((m) => m.SceneRanch3D), {
  ssr: false,
  loading: () => <Threshold />,
});
const SceneRanch = dynamic(() => import('@/components/story/scene-ranch').then((m) => m.SceneRanch), {
  ssr: false,
  loading: () => <Threshold />,
});

export type Quality = 'full' | 'low';

/**
 * Whether the built scene can run, and how well. A software renderer (a headless browser, a
 * machine without a GPU) gets the drawn scene under automation and the low setting otherwise;
 * `?scene=3d` or `?scene=drawn` overrides, which is how the film asks for the built one.
 */
function choose(): { built: boolean; quality: Quality } {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get('scene');
  let renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { built: false, quality: 'low' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    // A browser allows only a handful of contexts at once; this one was a question, not a scene.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return { built: false, quality: 'low' };
  }
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
  const quality: Quality = params.get('quality') === 'full' ? 'full' : software ? 'low' : 'full';
  if (asked === 'drawn') return { built: false, quality: 'low' };
  if (asked === '3d') return { built: true, quality };
  // Automation runs the drawn scene: a software GPU under a test runner is time the tests do not have.
  if (navigator.webdriver) return { built: false, quality: 'low' };
  return { built: true, quality };
}

export function SceneRanchLoader({ xray, summary }: { xray: Xray | null; summary: OperationsSummary | null }) {
  // Both scenes are loaded the same way and show the same door while they load, so the server
  // (which knows no canvas) and the client's first render agree whichever the client chooses.
  const [choice] = useState(() =>
    typeof document === 'undefined' ? { built: true, quality: 'full' as Quality } : choose(),
  );
  return choice.built ? (
    <SceneRanch3D xray={xray} summary={summary} quality={choice.quality} />
  ) : (
    <SceneRanch xray={xray} summary={summary} />
  );
}

/** The closed door, with the thesis on it: what the server renders and what a person without script reads. */
function Threshold() {
  return (
    <div className="relative h-[100svh] overflow-hidden" data-testid="ranch">
      <div
        className="absolute inset-y-0 left-0 w-1/2 border-r border-white/[0.08]"
        style={{ background: 'repeating-linear-gradient(90deg, #17120f 0 88px, #1c1613 88px 90px)' }}
        aria-hidden
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2 border-l border-white/[0.08]"
        style={{ background: 'repeating-linear-gradient(90deg, #17120f 0 88px, #1c1613 88px 90px)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{ boxShadow: '0 0 60px 18px rgb(212 138 96 / 0.35), 0 0 6px 2px rgb(243 237 228 / 0.7)' }}
        aria-hidden
      />
      <div className="absolute left-[5vw] right-[5vw] top-[11svh] z-10 md:top-[18svh]">
        <p className="mb-5 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.17em] text-muted-foreground">
          <span className="h-px w-8 bg-copper-2" aria-hidden /> Unofficial candidate build · September 2026 · synthetic
          data
        </p>
        <h1
          id="thesis"
          className="display max-w-[900px] text-[clamp(40px,6vw,104px)] leading-[0.94] tracking-[-0.05em] text-paper"
        >
          The records already exist.
          <br />
          <em className="block">The hard part is knowing what they mean together.</em>
        </h1>
      </div>
    </div>
  );
}

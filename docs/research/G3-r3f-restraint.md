# G3 — R3F small-scene research (sub-report to G), verified 2026-09-16

## Version reality
- `@react-three/fiber` 9.7.0 stable; peers `react >=19 <19.3`. **React 19.3.0 (Sep 2026) breaks `npm ci`** → pin react/react-dom 19.2.x if R3F is ever added. v10 is alpha (WebGPU) — do not build on it.
- `@react-three/drei` 10.7.8; `sideEffects:false`, named imports tree-shake. drei 11 alphas pair only with fiber 10 alphas.
- Next 16: Turbopack default; "First Load JS" removed from build output → use `@next/bundle-analyzer`.

## Bundle (gzip, measured)
| Package | gzip |
|---|---|
| three 0.186 whole | ~191 KB (Canvas calls `extend(THREE)` → not tree-shaken) |
| @react-three/fiber 9.7.0 | ~52 KB |
| drei `Html` + maath + IO | ~10 KB |
| **Realistic lazy chunk** | **~250 KB gz (~0.9 MB parsed)** |
Acceptable only if dynamic-imported, in-view gated, absent from shared layouts, with a static fallback. Never in the route's initial bundle.

## If R3F is ever used (recipe kept for V2)
- `'use client'` wrapper; `next/dynamic(() => import('./Scene'), { ssr:false, loading: () => <RanchTopologySvg static/> })`; in-view gate (`react-intersection-observer`, 1.6 KB); reserved box (`aspect-[16/7] min-h-[280px]`) → no CLS.
- `<Canvas frameloop="demand" dpr={[1,1.5]} flat shadows={false} gl={{ antialias:true, alpha:true, powerPreference:'default', stencil:false }} camera={{ fov:35, position:[6,5,8] }} fallback={<RanchTopologySvg/>}>`.
- Camera settle via `maath/easing` `damp3` + `invalidate()` while moving; no CameraControls.
- Plane: `planeGeometry [12,12,1,1]` + `shaderMaterial`, inline stegu `snoise` (MIT), contour lines via `fract`/`fwidth`/`smoothstep`. Pins: cylinder + cone, `flatShading`, shared module-scope geometry/material. 4–5 draw calls.
- Reduced motion: `useSyncExternalStore` on `(prefers-reduced-motion: reduce)` with server snapshot `true` → SSR emits the SVG. No-WebGL: `getContext('webgl2', { failIfMajorPerformanceCaveat:true })` null → SVG. Error boundary → SVG.
- Labels: drei `<Html center zIndexRange={[10,0]} style={{pointerEvents:'none'}}>`; never `occlude` (sets `display:none` → removed from a11y tree). Add a visually-hidden `<ul>` of the 3 ranches with `aria-live="polite"`; label `<button>`s drive the same hover state.
- Integrated GPU rules: no post-processing, shadows off, `flat`, ≤1 directional + ambient, DPR ≤1.5, demand loop, no `setState` in `useFrame`, exactly one Canvas, never `key` it. Known: Next 16 `cacheComponents` + back/forward fails to remount an R3F scene (issue #3595).

## Pure SVG alternative (what V1 ships)
- 96×96 `simplex-noise` grid → `d3.contours().size([96,96]).thresholds(12)` → serialize rings to `d` → `<path fill="none" vector-effect="non-scaling-stroke">`. Or pre-bake once in a Node script and commit the `d` strings: **0 KB runtime, SSR-able**.
- Isometric: pre-project points with `(1/√6)·[[√3,0,−√3],[−1,2,−1]]` and draw plain 2D SVG (crisper than CSS 3D transforms; no text blur; no Firefox `preserve-3d` quirks).
- Motion: CSS `@keyframes` pulse on exception pins, gated by `@media (prefers-reduced-motion: reduce){animation:none}`.
- SVG nodes are DOM: focus, `aria-label`, CSS hover. `role="img"` + `<title>/<desc>` on the root.

## Decision matrix (5 = best)
| Criterion | R3F | SVG / Canvas-2D | CSS-3D |
|---|---|---|---|
| Bundle (lazy) | 1 | 5 | 5 |
| Perf on 1366×768 Intel | 3 | 5 | 4 |
| a11y / reduced motion | 2 | 5 | 4 |
| Dev effort | 2 | 4 | 3 |
| Visual payoff | 5 | 3–4 | 4 |
| Maintenance | 2 | 5 | 4 |
| **Total** | **15** | **27–28** | **24** |

**Verdict:** ship the SVG topology (pre-baked contours, isometric pins, CSS pulse) as a server-renderable component. R3F only wins with real depth/occlusion, camera moves, hundreds of nodes — none apply. Keep R3F as a V2 upgrade path reusing the SVG as fallback.

## Sources (selected)
r3f.docs.pmnd.rs/advanced/scaling-performance · r3f.docs.pmnd.rs/api/canvas · r3f.docs.pmnd.rs/tutorials/v9-migration-guide · github.com/pmndrs/react-three-fiber/blob/master/packages/fiber/src/web/Canvas.tsx · github.com/pmndrs/drei/blob/master/src/web/Html.tsx · github.com/pmndrs/detect-gpu · github.com/stegu/webgl-noise/blob/master/src/noise2D.glsl · bundlephobia.com (three, fiber, drei) · infrequently.org/2024/01/performance-inequality-gap-2024/ · nextjs.org/docs/app/guides/lazy-loading · web.dev/articles/lcp · w3.org/WAI/WCAG22/Techniques/client-side-script/SCR40 · joshwcomeau.com/snippets/react-hooks/use-prefers-reduced-motion/ · d3js.org/d3-contour/contour · developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect

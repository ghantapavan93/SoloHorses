'use client';

import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ChevronDown } from 'lucide-react';
import {
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { BlurWords } from '@/components/motion/reveal';
import { SlabMare, loadMare, type Mare, type ModelMare } from '@/components/story/ranch/mare';
import { PLANE_Z, Rig, layoutFor, type Edge } from '@/components/story/ranch/rig';
import {
  CONTEXTS,
  MAX_TAGS,
  STAGE,
  TONE,
  contextCounts,
  easeInOut,
  layout,
  onPhone,
  pickTags,
  span,
  type Tag,
} from '@/components/story/ranch/tags';
import { Barn, EvidenceFrame, Fence, HORIZON, SUN, Sky, Terrain } from '@/components/story/ranch/world';
import type { OperationsSummary, Xray } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The threshold, built. The camera starts inside a barn, on two doors closed over a seam of
 * morning. As the person scrolls, the doors swing out and the camera walks through into the
 * field: a low sun ahead, a fence along the level ground, hills drawn in contour lines fading
 * into the fog. She walks in along the fence — the same horse as the drawing, given a body and
 * a shadow — and her records attach to her, one by one, the x-ray's own nodes. Then her outline
 * leaves her: segment by segment, the line she is drawn with becomes the edges of the graph,
 * and the records settle into the x-ray's own columns; the block and the person join; the five
 * contexts converge on the person. Nothing moves without the scroll; nothing renders while it
 * is still. Reduced motion holds the final frame. The words step back to the left as she
 * arrives, and stay.
 */
export function SceneRanch3D({
  xray,
  summary,
  quality = 'full',
}: {
  xray: Xray | null;
  summary: OperationsSummary | null;
  quality?: 'full' | 'low';
}) {
  const reduce = useReducedMotion();
  const outer = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  // Client-only, so the viewport is known at the first render: no phone lays out as a desk and then jumps.
  const [size, setSize] = useState<{ w: number; h: number } | null>(() =>
    typeof window === 'undefined' ? null : { w: window.innerWidth, h: window.innerHeight },
  );
  const { scrollYProgress } = useScroll({ target: outer, offset: ['start start', 'end end'] });
  const still = useMotionValue(1);
  const progress = reduce ? still : scrollYProgress;
  // Frames run on their own only while she is on screen and motion is welcome: the wind in her hair
  // and the dust at her hooves are the only things that move without the scroll. Before the doors
  // open and once she has become the graph, the scene renders only when the scroll asks.
  const inView = useInView(outer, { margin: '0px 0px 0px 0px' });
  const [walking, setWalking] = useState(false);
  useMotionValueEvent(progress, 'change', (v) => {
    const w = v > 0.06 && v < STAGE.graph[0] + 0.06;
    if (w !== walking) setWalking(w);
  });
  const live = inView && !reduce && walking;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const w = size?.w ?? 1366;
  const phone = w < 768;
  const tags = useMemo(() => pickTags(xray), [xray]);
  const visible = useMemo(() => tags.map((t) => !phone || onPhone(t, xray)), [tags, phone, xray]);
  const counts = useMemo(() => contextCounts(summary), [summary]);
  const L = useMemo(() => layoutFor(phone), [phone]);
  // One element per tag slot, moved by the rig; the refs are state so render never reads them.
  const [tagDom] = useState<RefObject<HTMLDivElement | null>[]>(() =>
    Array.from({ length: MAX_TAGS }, () => createRef<HTMLDivElement>()),
  );

  const contextsIn = useTransform(progress, (p) => span(p, [STAGE.tags[0], STAGE.tags[0] + 0.12]));
  const subtitle = useTransform(progress, (p) => span(p, [STAGE.graph[0] + 0.14, STAGE.graph[1]]));
  const hint = useTransform(progress, (p) => 1 - span(p, [0.02, 0.08]));
  const words = useTransform(progress, (p) => 1 - (phone ? 0.3 : 0.46) * easeInOut(span(p, [0.12, 0.3])));

  return (
    <div
      ref={outer}
      className={cn('relative', reduce ? 'h-[100svh]' : phone ? 'h-[240svh]' : 'h-[340svh]')}
      data-testid="ranch"
      data-scene="3d"
    >
      <div ref={stage} className="sticky top-0 h-[100svh] overflow-hidden bg-[#0f0c0a]">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <Canvas
            frameloop={live && quality === 'full' ? 'always' : 'demand'}
            dpr={quality === 'low' ? 1 : [1, 1.5]}
            shadows={!phone && quality === 'full' ? 'percentage' : false}
            camera={{ fov: 42, near: 0.1, far: 700, position: [0, 1.6, 5.5] }}
            gl={{ antialias: quality === 'full', alpha: false, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => gl.setClearColor(HORIZON)}
          >
            <Director
              progress={progress}
              xray={xray}
              tags={tags}
              visible={visible}
              counts={counts}
              layout={L}
              tagDom={tagDom}
              quality={quality}
            />
          </Canvas>
        </div>

        {/* The records, as tags the rig moves: on her first, then in the x-ray's own places. */}
        {Array.from({ length: MAX_TAGS }, (_, i) => tags[i] ?? null).map((tag, i) =>
          tag ? (
            <div
              key={tag.node.id}
              ref={tagDom[i]}
              className="pointer-events-none absolute left-0 top-0 will-change-transform"
              style={{ opacity: 0 }}
              aria-hidden
            >
              <div
                className={cn(
                  'card-op whitespace-nowrap px-2 py-1.5 text-[10.5px] leading-tight shadow-[0_10px_30px_rgb(0_0_0/0.45)]',
                  tag.node.type === 'decision' && 'border-warn/60',
                  tag.node.id === xray?.blockId && 'border-warn/50',
                )}
              >
                <p className="flex items-center gap-1.5 font-medium text-paper">
                  <span className={cn('size-1.5 shrink-0 rounded-full', TONE[tag.node.status])} />
                  <span
                    className={cn(
                      tag.node.type === 'record' || tag.node.type === 'subject' || tag.node.type === 'money'
                        ? 'code'
                        : '',
                    )}
                  >
                    {tag.node.label.length > 26 ? `${tag.node.label.slice(0, 25)}…` : tag.node.label}
                  </span>
                </p>
                {tag.node.sublabel ? (
                  <p className="mt-0.5 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                    {tag.node.sublabel.length > 30 ? `${tag.node.sublabel.slice(0, 29)}…` : tag.node.sublabel}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null,
        )}

        {/* The five contexts, arriving as she does; each with what it holds open. */}
        <motion.ul
          className={cn(
            'absolute inset-x-0 flex flex-wrap gap-x-6 gap-y-1 px-[5vw]',
            phone ? 'bottom-[7svh] justify-center' : 'top-[9svh] justify-end',
          )}
          style={{ opacity: contextsIn }}
          aria-label="The five contexts"
        >
          {CONTEXTS.map((c, i) => (
            <li
              key={c.label}
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              <span
                className={cn('size-1.5 rounded-full', counts[i]! > 0 ? 'bg-copper-2' : 'bg-white/20')}
                aria-hidden
              />
              <span className={cn(counts[i]! > 0 && 'text-paper')}>{c.label}</span>
              <span className="tabular-nums">{counts[i]}</span>
            </li>
          ))}
        </motion.ul>

        {/* The words. */}
        <motion.div
          className={cn('absolute left-[5vw] right-[5vw] z-10', phone ? 'top-[11svh]' : 'top-[18svh]')}
          style={{ scale: words, originX: 0, originY: 0 }}
        >
          <p className="mb-5 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.17em] text-muted-foreground">
            <span className="h-px w-8 bg-copper-2" aria-hidden /> Unofficial candidate build · September 2026 ·
            synthetic data
          </p>
          <h1
            id="thesis"
            className="display max-w-[900px] text-[clamp(40px,6vw,104px)] leading-[0.94] tracking-[-0.05em] text-paper"
          >
            <BlurWords text="The records already exist." />
            <br />
            <motion.em className="block" style={{ opacity: subtitle }}>
              The hard part is knowing what they mean together.
            </motion.em>
          </h1>
        </motion.div>

        <motion.p
          className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          style={{ opacity: hint }}
          aria-hidden
        >
          <ChevronDown className="size-3.5" /> Scroll
        </motion.p>
      </div>
    </div>
  );
}

/** Everything in the scene, and the rig that moves it from one number. */
function Director({
  progress,
  xray,
  tags,
  visible,
  counts,
  layout: L,
  tagDom,
  quality,
}: {
  progress: MotionValue<number>;
  xray: Xray | null;
  tags: Tag[];
  visible: boolean[];
  counts: number[];
  layout: ReturnType<typeof layoutFor>;
  tagDom: RefObject<HTMLDivElement | null>[];
  quality: 'full' | 'low';
}) {
  const { camera, size, invalidate, scene } = useThree();
  const p = useRef(progress.get());
  useMotionValueEvent(progress, 'change', (v) => {
    p.current = v;
    invalidate();
  });

  const leftDoor = useRef<THREE.Group | null>(null);
  const rightDoor = useRef<THREE.Group | null>(null);
  const sun = useRef<THREE.DirectionalLight | null>(null);
  const frame = useRef<THREE.MeshBasicMaterial | null>(null);
  const seam = useRef<THREE.MeshBasicMaterial | null>(null);
  const [rig] = useState(() => new Rig());
  // The drawing stands in until the rigged mare arrives; if she never does, the drawing stays.
  const [slab] = useState(() => new SlabMare());
  const [model, setModel] = useState<ModelMare | null>(null);
  const mare: Mare = model ?? slab;
  useEffect(() => {
    let alive = true;
    let loaded: ModelMare | null = null;
    loadMare()
      .then((m) => {
        if (!alive) return void m.dispose();
        loaded = m;
        setModel(m);
      })
      .catch((error: unknown) =>
        console.warn(`[story] the rigged mare did not load; the drawing stands in (${(error as Error).message})`),
      );
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, []);
  useEffect(() => () => slab.dispose(), [slab]);
  // A new mare is drawn as soon as she is here, scroll or no scroll.
  useEffect(() => invalidate(), [mare, invalidate]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.set(0, 0, PLANE_Z);
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);
  useEffect(() => () => rig.dispose(), [rig]);

  // Where each record settles, in metres on the plane she stood on; and the edges between them.
  const places = useMemo(() => {
    const unit = layout(tags, visible, L.phone);
    const at = new Map<string, THREE.Vector3>();
    for (const [id, [ux, uy]] of unit)
      at.set(id, new THREE.Vector3(L.box.x + ux * L.box.w, L.box.y - uy * L.box.h, PLANE_Z));
    return at;
  }, [tags, visible, L]);
  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(tags.map((t, i) => [t.node.id, i]));
    const fallback = new THREE.Vector3(L.box.x + L.box.w / 2, L.box.y - L.box.h / 2, PLANE_Z);
    const at = (id: string) => places.get(id) ?? fallback;
    return xray
      ? xray.edges
          .filter((e) => byId.has(e.from) && byId.has(e.to) && visible[byId.get(e.from)!] && visible[byId.get(e.to)!])
          .map((e) => ({ from: at(e.from), to: at(e.to), toBlock: e.to === xray.blockId }))
      : [];
  }, [xray, tags, visible, places, L]);
  const decisionAt = useMemo(() => {
    const decision = tags.find((t) => t.node.type === 'decision');
    return (
      (decision && places.get(decision.node.id)) ?? new THREE.Vector3(L.box.x + L.box.w, L.box.y - L.box.h / 2, PLANE_Z)
    );
  }, [tags, places, L]);

  useEffect(() => {
    rig.configure({ layout: L, tags, visible, counts, places, edges, decisionAt });
    invalidate();
  }, [rig, L, tags, visible, counts, places, edges, decisionAt, invalidate]);

  useFrame((state, delta) => {
    rig.update(
      p.current,
      {
        camera,
        size,
        mare,
        leftDoor: leftDoor.current,
        rightDoor: rightDoor.current,
        frame: frame.current,
        seam: seam.current,
        tagDom: tagDom.map((r) => r.current),
      },
      state.clock.elapsedTime,
      Math.min(delta, 0.1),
    );
  });

  return (
    <>
      <fogExp2 attach="fog" args={[HORIZON, 0.012]} />
      <hemisphereLight args={['#4a2e20', '#0b0807', 0.9]} />
      {/* The morning bouncing back off the barn: a soft fill from behind the camera, so she reads as a body and not a hole. */}
      <directionalLight position={[-6, 5, 4]} intensity={0.7} color="#c9b1a0" />
      <directionalLight
        ref={sun}
        position={[SUN.x * 70, SUN.y * 70 + 2, PLANE_Z + SUN.z * 70]}
        intensity={2.4}
        color="#e0a074"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={30}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />
      <Sky />
      <Terrain segments={quality === 'low' ? 56 : L.phone ? 72 : 120} />
      <Fence />
      <Barn leftDoor={leftDoor} rightDoor={rightDoor} seamRef={seam} />
      <primitive object={mare.group} />
      {model ? <primitive object={model.dust.group} /> : null}
      <EvidenceFrame box={L.box} z={PLANE_Z} materialRef={frame} />
      <primitive object={rig.group} />
    </>
  );
}

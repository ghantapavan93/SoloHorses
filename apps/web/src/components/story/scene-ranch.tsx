'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  motion,
  motionValue,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { BlurWords } from '@/components/motion/reveal';
import { HORSE_ATTACH, HORSE_VIEWBOX, Horse, type HorseAttach } from '@/components/story/horse';
import {
  CONTEXTS,
  MAX_TAGS,
  STAGE,
  TONE,
  arrival,
  contextCounts,
  easeInOut,
  easeOut,
  layout,
  onPhone,
  pickTags,
  span,
  type Tag,
} from '@/components/story/ranch/tags';
import type { OperationsSummary, Xray, XrayNode } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The threshold. A barn door parts on a morning; a mare walks in; her records attach to her one
 * by one — the same rows the x-ray holds; then her outline gives way and the records settle into
 * the x-ray's own layout, the five contexts converging on the person the chain waits for.
 *
 * Everything moves with the scroll and nothing without it: the doors, the walk, the gait, the
 * tags, the graph. The page never takes the wheel. Reduced motion shows the final frame. The
 * records, their positions and the edges between them come from the x-ray projection; the
 * drawing is original.
 */
export function SceneRanch({ xray, summary }: { xray: Xray | null; summary: OperationsSummary | null }) {
  const reduce = useReducedMotion();
  const outer = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const { scrollYProgress } = useScroll({ target: outer, offset: ['start start', 'end end'] });
  const still = useMotionValue(1);
  const progress = reduce ? still : scrollYProgress;

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
  const h = size?.h ?? 768;
  const phone = w < 768;
  const tags = useMemo(() => pickTags(xray), [xray]);
  const visible = tags.map((t) => !phone || onPhone(t, xray));
  // Her box, in pixels of the stage: hooves on the ground line, walking in from the left.
  const horseW = phone ? w * 0.82 : Math.min(w * 0.38, 560);
  const horseH = (horseW * HORSE_VIEWBOX.h) / HORSE_VIEWBOX.w;
  const ground = phone ? h * 0.72 : h * 0.78;
  const horseTop = ground - (horseH * HORSE_VIEWBOX.ground) / HORSE_VIEWBOX.h;
  const xFrom = -horseW * 1.1;
  const xTo = phone ? w * 0.5 - horseW * 0.5 : w * 0.64 - horseW * 0.5;
  const horseLeft = (p: number) => xFrom + (xTo - xFrom) * easeOut(span(p, STAGE.walk));
  // The camera follows her: the fence and the hills slide the other way, the far ones slower.
  const fenceX = useTransform(progress, (p) => -w * 0.22 * span(p, STAGE.walk));
  const hillsX = useTransform(progress, (p) => -w * 0.06 * span(p, STAGE.walk));
  const horseX = useTransform(progress, (p) => horseLeft(p));
  const phase = useTransform(progress, (p) => ((horseLeft(p) - xFrom) / (horseW * 0.42)) * Math.PI * 2);
  const erase = useTransform(progress, (p) => easeInOut(span(p, [STAGE.graph[0], STAGE.graph[0] + 0.16])));
  const shadow = useTransform(progress, (p) => 1 - span(p, [STAGE.graph[0], STAGE.graph[0] + 0.12]));
  const doorL = useTransform(progress, (p) => -(w / 2 + 40) * easeInOut(span(p, STAGE.doors)));
  const doorR = useTransform(progress, (p) => (w / 2 + 40) * easeInOut(span(p, STAGE.doors)));
  const seam = useTransform(progress, (p) => 1 - span(p, [0.04, 0.14]));
  const morning = useTransform(progress, (p) => 0.35 + 0.65 * span(p, [0.02, 0.2]));
  const contextsIn = useTransform(progress, (p) => span(p, [STAGE.tags[0], STAGE.tags[0] + 0.12]));
  const converge = useTransform(progress, (p) => span(p, [STAGE.graph[0] + 0.1, STAGE.graph[1]]));
  const subtitle = useTransform(progress, (p) => span(p, [STAGE.graph[0] + 0.14, STAGE.graph[1]]));
  const hint = useTransform(progress, (p) => 1 - span(p, [0.02, 0.08]));
  // The words step back as she arrives: the thesis stays, smaller, and the graph gets the room.
  const words = useTransform(progress, (p) => 1 - (phone ? 0.3 : 0.46) * easeInOut(span(p, [0.12, 0.3])));

  // Where each record settles: the x-ray's own columns, in its order, spread evenly so no tag sits on another.
  const graphBox = phone ? { x: 0.08, y: 0.4, w: 0.84, h: 0.44 } : { x: 0.34, y: 0.2, w: 0.63, h: 0.62 };
  const graphAt = useMemo(() => {
    const unit = layout(tags, visible, phone);
    return (node: XrayNode): [number, number] => {
      const u = unit.get(node.id);
      return u ? [w * (graphBox.x + u[0] * graphBox.w), h * (graphBox.y + u[1] * graphBox.h)] : [w / 2, h / 2];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `visible` is derived from `phone` and `tags`, both listed.
  }, [tags, phone, w, h, graphBox.x, graphBox.y, graphBox.w, graphBox.h]);
  const attachAt = (p: number, attach: HorseAttach): [number, number] => {
    const [fx, fy] = HORSE_ATTACH[attach];
    return [horseLeft(p) + fx * horseW, horseTop + fy * horseH];
  };

  // A fixed set of motion values for the tags, driven from the one progress value: no hook per tag.
  const slots = Array.from({ length: MAX_TAGS }, (_, i) => tags[i] ?? null);
  const tagMotion = useMemo(
    () =>
      Array.from({ length: MAX_TAGS }, () => ({
        x: motionValue(0),
        y: motionValue(0),
        ax: motionValue(0),
        ay: motionValue(0),
        opacity: motionValue(0),
        scale: motionValue(1),
        leader: motionValue(0),
      })),
    [],
  );
  const place = (p: number) => {
    slots.forEach((tag, i) =>
      placeTag(tagMotion[i]!, p, tag, i, visible[i] ?? false, attachAt, graphAt, horseW, horseH, [
        phone ? 78 : 120,
        w - (phone ? 78 : 120),
      ]),
    );
  };
  useMotionValueEvent(progress, 'change', place);
  // Sizes and rows change without a scroll; the tags follow at once.
  useEffect(() => {
    place(progress.get());
  });
  const decision = tags.find((t) => t.node.type === 'decision') ?? null;
  const decisionAt = decision ? graphAt(decision.node) : [w / 2, h * 0.7];
  const byId = new Map(tags.map((t, i) => [t.node.id, i]));
  const edges = xray
    ? xray.edges
        .filter((e) => byId.has(e.from) && byId.has(e.to) && visible[byId.get(e.from)!] && visible[byId.get(e.to)!])
        .map((e) => ({ id: e.id, a: byId.get(e.from)!, b: byId.get(e.to)!, toBlock: e.to === xray.blockId }))
    : [];
  const counts = contextCounts(summary);

  return (
    <div
      ref={outer}
      className={cn('relative', reduce ? 'h-[100svh]' : phone ? 'h-[220svh]' : 'h-[320svh]')}
      data-testid="ranch"
      data-scene="drawn"
    >
      <div ref={stage} className="sticky top-0 h-[100svh] overflow-hidden">
        {/* The morning: a warm horizon under a dark sky, contour terrain, far hills. */}
        <motion.div className="absolute inset-0" style={{ opacity: morning }} aria-hidden>
          <div
            className="absolute inset-x-0"
            style={{
              top: ground - h * 0.3,
              height: h * 0.36,
              background:
                'radial-gradient(70% 100% at 55% 100%, rgb(212 138 96 / 0.34), rgb(212 138 96 / 0.1) 50%, transparent 80%)',
            }}
          />
          <motion.svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            style={{ x: hillsX }}
          >
            <path
              d={`M -100 ${ground - h * 0.16} C ${w * 0.2} ${ground - h * 0.24}, ${w * 0.38} ${ground - h * 0.1}, ${w * 0.55} ${ground - h * 0.17} S ${w * 0.9} ${ground - h * 0.08}, ${w + 200} ${ground - h * 0.14} L ${w + 200} ${ground + 4} L -100 ${ground + 4} Z`}
              fill="#1c1511"
            />
            <path
              d={`M -100 ${ground - h * 0.09} C ${w * 0.25} ${ground - h * 0.14}, ${w * 0.5} ${ground - h * 0.05}, ${w * 0.7} ${ground - h * 0.1} S ${w * 0.95} ${ground - h * 0.03}, ${w + 200} ${ground - h * 0.07} L ${w + 200} ${ground + 4} L -100 ${ground + 4} Z`}
              fill="#17110e"
            />
          </motion.svg>
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            {Array.from({ length: 9 }, (_, i) => {
              const y = ground + 6 + i * ((h - ground) / 9) * 1.1;
              return (
                <path
                  key={i}
                  d={`M 0 ${y} C ${w * 0.25} ${y - 6 - i * 1.5}, ${w * 0.5} ${y + 8}, ${w * 0.75} ${y - 4} S ${w} ${y + 5}, ${w} ${y}`}
                  fill="none"
                  stroke="#c9b9a3"
                  strokeOpacity={0.14 - i * 0.012}
                  strokeWidth={0.8}
                />
              );
            })}
            <line x1={0} y1={ground} x2={w} y2={ground} stroke="#c9b9a3" strokeOpacity={0.22} strokeWidth={0.8} />
          </svg>
          {/* The fence, in perspective, sliding as she walks. */}
          <motion.svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            style={{ x: fenceX }}
          >
            {Array.from({ length: 7 }, (_, i) => {
              const t = i / 6;
              const x = w * 0.05 + t * w * 1.25;
              const scale = 1 - t * 0.45;
              const postH = (phone ? h * 0.13 : h * 0.17) * scale;
              const y = ground + 2 - t * (phone ? 6 : 10);
              return (
                <line
                  key={i}
                  x1={x}
                  y1={y}
                  x2={x}
                  y2={y - postH}
                  stroke="#c9b9a3"
                  strokeOpacity={0.5 - t * 0.25}
                  strokeWidth={1.4 - t * 0.5}
                />
              );
            })}
            <path
              d={`M ${w * 0.05} ${ground - (phone ? h * 0.1 : h * 0.13)} L ${w * 1.3} ${ground - 8 - (phone ? h * 0.1 : h * 0.13) * 0.55}`}
              fill="none"
              stroke="#c9b9a3"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
            <path
              d={`M ${w * 0.05} ${ground - (phone ? h * 0.05 : h * 0.07)} L ${w * 1.3} ${ground - 8 - (phone ? h * 0.05 : h * 0.07) * 0.55}`}
              fill="none"
              stroke="#c9b9a3"
              strokeOpacity={0.3}
              strokeWidth={1}
            />
          </motion.svg>
        </motion.div>

        {/* Her shadow on the ground, and her. */}
        <motion.div
          className="absolute rounded-[50%]"
          style={{
            left: horseX,
            top: ground - 6,
            width: horseW * 0.66,
            height: 12,
            marginLeft: horseW * 0.17,
            opacity: shadow,
            background: 'radial-gradient(50% 50% at 50% 50%, rgb(0 0 0 / 0.55), transparent 70%)',
          }}
          aria-hidden
        />
        <motion.div
          className="absolute"
          style={{ left: 0, top: horseTop, width: horseW, height: horseH, x: horseX }}
          aria-hidden
        >
          <Horse phase={phase} erase={erase} className="h-full w-full overflow-visible" />
        </motion.div>

        {/* Leader lines while the records attach to her; edges once they are the graph. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {slots.map((tag, i) =>
            tag && tag.attach ? (
              <motion.line
                key={tag.node.id}
                x1={tagMotion[i]!.x}
                y1={tagMotion[i]!.y}
                x2={tagMotion[i]!.ax}
                y2={tagMotion[i]!.ay}
                stroke="#d48a60"
                strokeOpacity={0.7}
                strokeWidth={1}
                style={{ opacity: tagMotion[i]!.leader }}
              />
            ) : null,
          )}
          {edges.map((e) => (
            <motion.line
              key={e.id}
              x1={tagMotion[e.a]!.x}
              y1={tagMotion[e.a]!.y}
              x2={tagMotion[e.b]!.x}
              y2={tagMotion[e.b]!.y}
              stroke={e.toBlock ? '#d9a45f' : '#c9b9a3'}
              strokeOpacity={e.toBlock ? 0.95 : 0.55}
              strokeWidth={e.toBlock ? 1.8 : 1.2}
              style={{ pathLength: converge, opacity: converge }}
            />
          ))}
          {CONTEXTS.slice(0, phone ? 0 : 5).map((c, i) => (
            <motion.line
              key={c.label}
              x1={w * (0.4 + i * 0.13)}
              y1={h * 0.115}
              x2={decisionAt[0]}
              y2={decisionAt[1]}
              stroke="#d48a60"
              strokeOpacity={counts[i]! > 0 ? 0.28 : 0.1}
              strokeWidth={0.8}
              strokeDasharray="3 4"
              style={{ pathLength: converge, opacity: converge }}
            />
          ))}
        </svg>

        {/* The records, as tags: on her first, then in the x-ray's own places. */}
        {slots.map((tag, i) =>
          tag ? (
            <motion.div
              key={tag.node.id}
              className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
              style={{
                x: tagMotion[i]!.x,
                y: tagMotion[i]!.y,
                opacity: tagMotion[i]!.opacity,
                scale: tagMotion[i]!.scale,
              }}
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
                    {tag.node.label.length > 32 ? `${tag.node.label.slice(0, 31)}…` : tag.node.label}
                  </span>
                </p>
                {tag.node.sublabel ? (
                  <p className="mt-0.5 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                    {tag.node.sublabel.length > 30 ? `${tag.node.sublabel.slice(0, 29)}…` : tag.node.sublabel}
                  </p>
                ) : null}
              </div>
            </motion.div>
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

        {/* The doors. */}
        <motion.div
          className="absolute inset-y-0 left-0 w-1/2 border-r border-white/[0.08]"
          style={{ x: doorL, background: 'repeating-linear-gradient(90deg, #17120f 0 88px, #1c1613 88px 90px)' }}
          aria-hidden
        />
        <motion.div
          className="absolute inset-y-0 right-0 w-1/2 border-l border-white/[0.08]"
          style={{ x: doorR, background: 'repeating-linear-gradient(90deg, #17120f 0 88px, #1c1613 88px 90px)' }}
          aria-hidden
        />
        <motion.div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
          style={{
            opacity: seam,
            boxShadow: '0 0 60px 18px rgb(212 138 96 / 0.35), 0 0 6px 2px rgb(243 237 228 / 0.7)',
          }}
          aria-hidden
        />

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

type TagMotion = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  ax: MotionValue<number>;
  ay: MotionValue<number>;
  opacity: MotionValue<number>;
  scale: MotionValue<number>;
  leader: MotionValue<number>;
};

/** One tag at one progress: on her while she walks, then to its place in the graph. */
function placeTag(
  m: TagMotion,
  p: number,
  tag: Tag | null,
  index: number,
  visible: boolean,
  attachAt: (p: number, attach: HorseAttach) => [number, number],
  graphAt: (node: XrayNode) => [number, number],
  horseW: number,
  horseH: number,
  within: [number, number],
) {
  const keep = (x: number) => Math.max(within[0], Math.min(within[1], x));
  if (!tag || !visible) {
    m.opacity.set(0);
    m.leader.set(0);
    return;
  }
  const arrive = arrival(index);
  const goal = graphAt(tag.node);
  if (tag.attach) {
    const [ax, ay] = attachAt(p, tag.attach);
    const float: [number, number] = [ax + tag.offset[0] * horseW, ay + tag.offset[1] * horseH];
    const t = easeInOut(span(p, [STAGE.graph[0] + 0.04, STAGE.graph[1] - 0.04]));
    m.x.set(keep(float[0] + (goal[0] - float[0]) * t));
    m.y.set(float[1] + (goal[1] - float[1]) * t);
    m.ax.set(ax);
    m.ay.set(ay);
    m.opacity.set(span(p, arrive));
    m.scale.set(0.94 + 0.06 * span(p, arrive));
    m.leader.set(span(p, arrive) * (1 - span(p, [STAGE.graph[0], STAGE.graph[0] + 0.08])));
    return;
  }
  // The block and the person are not on her; they appear as the graph forms.
  m.x.set(goal[0]);
  m.y.set(goal[1]);
  m.opacity.set(span(p, [STAGE.graph[0] + 0.06, STAGE.graph[0] + 0.16]));
  m.scale.set(1);
  m.leader.set(0);
}

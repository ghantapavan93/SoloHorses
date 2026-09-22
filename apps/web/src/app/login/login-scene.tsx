'use client';

import { Suspense, use, useEffect, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { ContourField } from '@/components/landing/contour-field';
import { Horse } from '@/components/story/horse';
import { cn } from '@/lib/utils';

/**
 * The right half of the sign-in page: the field, the mare, and what the day holds — each card
 * a role and one true sentence from the seeded world (how many decisions wait, what she is
 * held on, what the money is waiting for). Not a testimonial: nobody is quoted, nobody is
 * pictured, because every person here is synthetic and the rule is that they stay that way.
 * The cards take turns; a person who asked for stillness gets the first one, and no turn. They
 * arrive as a promise from the server, so the field and the mare never wait for the API.
 */
export interface SceneCard {
  role: string;
  /** The sentence, read from the records. */
  line: string;
  detail?: string;
}

const TURN_MS = 5_000;

export function LoginScene({ cards, className }: { cards: Promise<SceneCard[]> | SceneCard[]; className?: string }) {
  const phase = useMotionValue(0);
  const erase = useMotionValue(0);

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-xl border bg-[#100c0a] text-paper',
        'bg-[radial-gradient(120%_80%_at_80%_20%,rgb(212_138_96/0.22),transparent_55%),radial-gradient(90%_70%_at_20%_100%,rgb(126_78_49/0.25),transparent_60%)]',
        className,
      )}
      aria-hidden
    >
      <ContourField sites={false} />
      {/* The mare, drawn the way the front door draws her, standing: this is her day the roles sign into. */}
      <motion.div
        className="absolute bottom-[12%] right-[6%] w-[62%] max-w-[520px]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
      >
        <Horse phase={phase} erase={erase} className="h-auto w-full" />
      </motion.div>
      <div className="absolute left-[6%] top-[8%] max-w-[60%]">
        <p className="text-[10px] uppercase tracking-[0.18em] text-paper/60">One mare’s day</p>
        <p className="display mt-2 text-[clamp(22px,2.4vw,32px)] leading-[1.02] tracking-[-0.03em] text-paper">
          Five systems each hold a piece of it.
        </p>
      </div>
      {/* What the day holds, one role at a time; nothing until the records have been read. */}
      <Suspense fallback={null}>
        <Cards cards={cards} />
      </Suspense>
    </div>
  );
}

function Cards({ cards: source }: { cards: Promise<SceneCard[]> | SceneCard[] }) {
  const cards = source instanceof Promise ? use(source) : source;
  const still = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (still || cards.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % cards.length), TURN_MS);
    return () => clearInterval(timer);
  }, [still, cards.length]);

  const card = cards[index] ?? cards[0];
  return (
    <>
      {card ? (
        <div className="absolute bottom-[6%] left-[6%] w-[min(360px,70%)]">
          <AnimatePresence mode="wait">
            <motion.div
              key={card.role}
              className="rounded-lg border border-white/10 bg-black/40 p-4 shadow-[0_20px_60px_rgb(0_0_0/0.45)] backdrop-blur-md"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="text-[10px] uppercase tracking-[0.16em] text-copper-2">{card.role}</p>
              <p className="mt-1.5 text-[15px] leading-snug text-paper">{card.line}</p>
              {card.detail ? <p className="mt-1.5 text-[12px] text-paper/60">{card.detail}</p> : null}
            </motion.div>
          </AnimatePresence>
          {cards.length > 1 ? (
            <div className="mt-3 flex gap-1.5">
              {cards.map((c, i) => (
                <span
                  key={c.role}
                  className={cn(
                    'h-0.5 w-6 rounded-full transition-colors',
                    i === index ? 'bg-copper-2' : 'bg-white/20',
                  )}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

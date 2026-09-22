'use client';

import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE, PRESET, SEC } from '@/lib/motion';

/**
 * Scroll-triggered reveal: a short rise and fade as a section enters, once. Under 300 ms,
 * transform and opacity only, on the product's one decelerating curve. The same primitive on
 * every public page, so the site has one voice. Adapted from the author's earlier front-end
 * work; the numbers are the house rules here.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'p';
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-64px 0px' }}
      transition={{ ...PRESET.reveal, delay }}
    >
      {children}
    </Tag>
  );
}

/** A group whose children arrive one after another, 50 ms apart. */
export function Stagger({
  children,
  className,
  style,
  label,
  step = 0.05,
  delay = 0,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** An accessible name for the group, when it is a list that stands for something. */
  label?: string;
  step?: number;
  delay?: number;
  as?: 'div' | 'ul' | 'ol';
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={style}
      aria-label={label}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-48px 0px' }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: step, delayChildren: delay } } }}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li';
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      variants={{ hidden: { opacity: 0, y: 10 }, shown: { opacity: 1, y: 0, transition: PRESET.reveal } }}
    >
      {children}
    </Tag>
  );
}

/** Words with their trailing whitespace kept, so the line occupies exactly the space it ends in and nothing reflows as words arrive. */
function tokenize(text: string): { word: string; trailing: string }[] {
  const out: { word: string; trailing: string }[] = [];
  const re = /(\S+)(\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ word: m[1]!, trailing: m[2] ?? '' });
  return out;
}

/**
 * Word-level blur-to-sharp reveal for a headline: each word arrives in reading order, out of a
 * blur, so a sentence lands the way it is read. The blur is what separates it from a fade —
 * focus being pulled reads as a camera finding its subject, not a div appearing. Reduced motion
 * renders the finished sentence with no transforms; the server renders it that way too, so the
 * page is right before any script runs.
 */
export function BlurWords({
  text,
  className,
  stagger = 0.055,
  delay = 0,
}: {
  text: string;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <span className={className}>
      {tokens.map((t, i) => (
        <Fragment key={i}>
          <motion.span
            className="inline-block"
            style={{ willChange: 'transform, filter, opacity' }}
            initial={{ opacity: 0, y: '0.3em', filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: '0em', filter: 'blur(0px)' }}
            transition={{ duration: SEC.reveal, delay: delay + i * stagger, ease: EASE.outQuart }}
          >
            {t.word}
          </motion.span>
          {t.trailing ? <span className="whitespace-pre">{t.trailing}</span> : null}
        </Fragment>
      ))}
    </span>
  );
}

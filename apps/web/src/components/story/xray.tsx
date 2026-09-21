'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { askFromAnywhere } from '@/components/landing/landing-ask';
import { hrefFor, label } from '@/lib/format';
import { EASE, PRESET } from '@/lib/motion';
import type { Xray, XrayNode } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The operational X-ray, drawn: every record the systems hold about one mare, the rules that
 * read them, what those rules found missing, the signals that raised, and the person the chain
 * waits for. Positions come from the API. Every node is a row: click it and the drawer shows
 * the facts as the table holds them, with the door to the record itself. The block is the only
 * node in the "waits for a person" colour; one dot travels the edge into it, under motion-safe.
 */
/** How the panel hands a question to the assistant: the page's own dock or palette (an event), or a link to the page that has one. */
export type XrayAsk = { kind: 'event' } | { kind: 'link'; hrefs: { why: string; prepare: string | null } };

/**
 * `reveal` is for the story world only: the graph draws itself once as it scrolls into view, node
 * by node in reading order, then the edges; a node that enters later (a request just created)
 * arrives on its own. Elsewhere the graph is simply there — nothing animates but a state change.
 * `highlightId` rings the node that just entered.
 */
export function XrayPanel({
  xray,
  className,
  ask,
  reveal = false,
  highlightId = null,
}: {
  xray: Xray;
  className?: string;
  ask?: XrayAsk | null;
  reveal?: boolean;
  highlightId?: string | null;
}) {
  const [selected, setSelected] = useState<XrayNode | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const inView = useInView(sectionRef, { once: true, margin: '-80px 0px' });
  // The first drawing is staggered; after it, a node that mounts is a change and arrives at once.
  // Stillness is the MotionConfig's to grant, so the markup is the same on the server and the client.
  const [drawn, setDrawn] = useState(!reveal);
  const animate = reveal;
  useEffect(() => {
    if (!animate || !inView || drawn) return;
    const t = setTimeout(() => setDrawn(true), 1400);
    return () => clearTimeout(t);
  }, [animate, inView, drawn]);
  const focusId = xray.focusId ?? xray.blockId;
  const focus = focusId ? (xray.nodes.find((n) => n.id === focusId) ?? null) : null;
  const blockedRules = xray.rulesApplied.filter((r) => r.verdict === 'blocked');
  const records = xray.nodes.filter((n) => n.recordRef && n.type !== 'signal').length;
  // The neighbourhood of the selected node: it, and every node an edge joins it to. The rest steps back.
  const near = selected
    ? new Set([
        selected.id,
        ...xray.edges.filter((e) => e.from === selected.id || e.to === selected.id).flatMap((e) => [e.from, e.to]),
      ])
    : null;
  // The causal path: everything the block was read from, and the person it waits for. Peripheral evidence stays, dimmer.
  const chain = useMemo(() => causalChain(xray), [xray]);
  const dimmed = (id: string) => (near ? !near.has(id) : chain ? !chain.has(id) : false);
  const dimTo = near ? 0.3 : 0.45;
  const byId = new Map(xray.nodes.map((n) => [n.id, n]));
  const ranked = [...xray.nodes].sort((a, b) => a.x - b.x || a.y - b.y);
  const into = xray.blockId ? xray.edges.find((e) => e.to === xray.blockId) : undefined;
  const path = (fromId: string, toId: string): string | null => {
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b) return null;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  };
  const summary = `${xray.conclusion} ${ranked.map((n) => `${n.label}${n.sublabel ? ` (${n.sublabel})` : ''}`).join(' → ')}.`;
  // Two questions the panel can hand over: why, and — when the vet owns the next step — the request the assistant may prepare.
  const whyQuestion = `What is blocking ${xray.subject}?`;
  const prepareQuestion =
    xray.unresolvedBoundary?.owner === 'VET' ? `Prepare the vet request for ${xray.subject}` : null;
  const rankOf = new Map(ranked.map((n, i) => [n.id, i]));
  const show = !animate || inView;
  return (
    <section
      id="why"
      ref={sectionRef}
      className={cn('rounded-md border', className)}
      data-testid="xray"
      data-drawn={animate ? (drawn ? 'yes' : 'no') : undefined}
    >
      <header className="border-b px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="eyebrow">X-ray · {xray.subject}</p>
          <span className="flex flex-wrap items-center gap-1.5">
            <AskButton
              ask={ask ?? null}
              question={whyQuestion}
              href={ask?.kind === 'link' ? ask.hrefs.why : null}
              testId="xray-ask-why"
            >
              Why?
            </AskButton>
            {prepareQuestion ? (
              <AskButton
                ask={ask ?? null}
                question={prepareQuestion}
                href={ask?.kind === 'link' ? ask.hrefs.prepare : null}
                testId="xray-prepare"
                primary
              >
                Prepare request
              </AskButton>
            ) : null}
          </span>
        </div>
        <dl
          className="mt-1.5 grid gap-x-4 gap-y-1 text-[12px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
          data-testid="xray-answers"
        >
          <div>
            <dt className="readout text-muted-foreground">blocked</dt>
            <dd className="font-medium leading-snug" data-testid="xray-conclusion">
              {focus && focus.type === 'signal' ? focus.label : xray.conclusion}
            </dd>
          </div>
          <div>
            <dt className="readout text-muted-foreground">who decides</dt>
            <dd className="leading-snug">
              {xray.unresolvedBoundary ? (
                <>
                  <span className="font-medium">{label(xray.unresolvedBoundary.owner)}</span> ·{' '}
                  {xray.unresolvedBoundary.next}
                </>
              ) : (
                'nobody: nothing waits on a person'
              )}
            </dd>
          </div>
          <div>
            <dt className="readout text-muted-foreground">evidence</dt>
            <dd className="leading-snug tabular-nums text-muted-foreground">
              {records} record{records === 1 ? '' : 's'} · {xray.rulesApplied.length} rule
              {xray.rulesApplied.length === 1 ? '' : 's'} applied
            </dd>
          </div>
        </dl>
      </header>

      <svg
        viewBox={`0 0 ${xray.width} ${xray.height}`}
        className="hidden h-auto w-full md:block"
        role="group"
        aria-label={summary}
      >
        {xray.edges.map((edge) => {
          const d = path(edge.from, edge.to);
          if (!d) return null;
          const toBlock = edge.to === xray.blockId;
          const onPath = !dimmed(edge.from) && !dimmed(edge.to);
          const touches = near ? near.has(edge.from) && near.has(edge.to) : onPath;
          const tone = toBlock ? 'stroke-warn' : onPath && chain ? 'stroke-copper-2' : 'stroke-border';
          if (!animate)
            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                className={cn('transition-opacity duration-[var(--dur-base)]', tone)}
                strokeWidth={toBlock ? 2 : onPath && chain ? 1.5 : 1.2}
                opacity={touches ? 1 : 0.25}
              />
            );
          // An edge is drawn from its source once both ends are on the page.
          const after = Math.max(rankOf.get(edge.from) ?? 0, rankOf.get(edge.to) ?? 0);
          return (
            <motion.path
              key={edge.id}
              d={d}
              fill="none"
              className={tone}
              strokeWidth={toBlock ? 2 : onPath && chain ? 1.5 : 1.2}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={show ? { pathLength: 1, opacity: touches ? 1 : 0.25 } : { pathLength: 0, opacity: 0 }}
              transition={drawn ? PRESET.enter : { duration: 0.5, ease: EASE.outQuart, delay: 0.25 + after * 0.07 }}
            />
          );
        })}
        {into ? (
          <circle r={3.5} className="hidden fill-warn motion-safe:block">
            <animateMotion
              dur="1.6s"
              repeatCount="indefinite"
              calcMode="spline"
              keyPoints="0;1"
              keyTimes="0;1"
              keySplines="0.4 0 0.2 1"
              path={path(into.from, into.to) ?? ''}
            />
          </circle>
        ) : null}
        {xray.nodes.map((node) => {
          const isBlock = node.id === xray.blockId;
          const isNew = highlightId !== null && node.id === highlightId;
          const Group = animate ? motion.g : 'g';
          const entrance = animate
            ? {
                initial: { opacity: 0, scale: 0.96 },
                animate: show ? { opacity: dimmed(node.id) ? dimTo : 1, scale: 1 } : { opacity: 0, scale: 0.96 },
                transition: drawn
                  ? PRESET.enter
                  : { duration: 0.42, ease: EASE.outQuart, delay: 0.1 + (rankOf.get(node.id) ?? 0) * 0.07 },
                style: { transformBox: 'fill-box' as const, transformOrigin: 'center' },
              }
            : {};
          return (
            <Group
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.label}${node.sublabel ? ` · ${node.sublabel}` : ''} · open the evidence`}
              data-testid={
                isNew ? 'xray-new' : isBlock ? 'xray-block' : node.id === xray.focusId ? 'xray-focus' : undefined
              }
              className={cn(
                'cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-[2.5] [&:hover>rect:first-child]:stroke-[2.2]',
                !animate && 'transition-opacity duration-[var(--dur-base)]',
                !animate && dimmed(node.id) && (near ? 'opacity-30' : 'opacity-45'),
              )}
              onClick={() => setSelected(node)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(node);
                }
              }}
              {...entrance}
            >
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={6}
                className={cn(
                  'fill-background transition-[stroke-width] duration-[var(--dur-fast)]',
                  tone(node),
                  selected?.id === node.id && 'stroke-brand',
                )}
                strokeWidth={isBlock || selected?.id === node.id ? 2.2 : 1.4}
              />
              {isBlock || node.status === 'blocked' ? (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={6}
                  className="fill-warn pointer-events-none"
                  fillOpacity={isBlock ? 0.1 : 0.05}
                />
              ) : null}
              {node.id === xray.focusId && !isBlock ? (
                <rect
                  x={node.x - 3}
                  y={node.y - 3}
                  width={node.w + 6}
                  height={node.h + 6}
                  rx={8}
                  className="fill-none stroke-brand pointer-events-none"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              ) : null}
              {isNew ? (
                <rect
                  x={node.x - 4}
                  y={node.y - 4}
                  width={node.w + 8}
                  height={node.h + 8}
                  rx={9}
                  className="fill-none stroke-ok pointer-events-none"
                  strokeWidth={2}
                >
                  <animate attributeName="stroke-opacity" values="1;0.25;1" dur="1.8s" repeatCount="3" />
                </rect>
              ) : null}
              <text
                x={node.x + 12}
                y={node.y + 19}
                className={cn(
                  'text-[12px]',
                  node.type === 'record' || node.type === 'subject' || node.type === 'rule' || node.type === 'money'
                    ? 'font-mono'
                    : 'font-medium',
                  'fill-foreground',
                )}
              >
                {node.label.length > 27 ? `${node.label.slice(0, 26)}…` : node.label}
              </text>
              {node.sublabel ? (
                <text
                  x={node.x + 12}
                  y={node.y + 35}
                  className="fill-muted-foreground text-[10px] uppercase"
                  style={{ letterSpacing: '0.12em' }}
                >
                  {node.sublabel.length > 32 ? `${node.sublabel.slice(0, 31)}…` : node.sublabel}
                </text>
              ) : null}
            </Group>
          );
        })}
      </svg>

      <ol className="space-y-1 px-3 py-2 text-[12px] md:hidden" aria-label={summary}>
        {ranked.map((node) => (
          <li
            key={node.id}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2',
              node.id === xray.blockId && 'font-medium text-warn',
              highlightId === node.id && 'text-ok',
            )}
            aria-current={node.id === xray.blockId ? 'step' : undefined}
          >
            <span className="readout w-[84px] shrink-0 text-muted-foreground">{node.type}</span>
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              onClick={() => setSelected(node)}
            >
              {node.label}
              {node.sublabel ? <span className="ml-1 text-muted-foreground">· {node.sublabel}</span> : null}
            </button>
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>rules applied:</span>
        {xray.rulesApplied.length === 0 ? <span>none</span> : null}
        {xray.rulesApplied.map((rule) => (
          <span key={rule.code} className="inline-flex items-baseline gap-1">
            <span className="code">{rule.code}</span>
            <span className={cn('readout', rule.verdict === 'blocked' ? 'text-warn' : 'text-ok')}>{rule.verdict}</span>
          </span>
        ))}
        <span className="ml-auto" title={blockedRules[0]?.reason ?? undefined}>
          click a node for the row behind it
        </span>
      </footer>

      <EvidenceDrawer
        node={selected}
        subject={xray.subject}
        rules={
          selected
            ? xray.rulesApplied.filter(
                (r) =>
                  (selected.recordRef && r.evidenceIds.includes(selected.recordRef)) ||
                  (selected.type === 'rule' && selected.label === r.label),
              )
            : []
        }
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

/** The nodes the block was read from, back to the mare, and the person it hands to; null when nothing is blocked. */
function causalChain(xray: Xray): Set<string> | null {
  if (!xray.blockId) return null;
  const chain = new Set<string>([xray.blockId]);
  const queue = [xray.blockId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const edge of xray.edges) {
      if (edge.to === id && !chain.has(edge.from)) {
        chain.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  for (const edge of xray.edges) if (edge.from === xray.blockId) chain.add(edge.to);
  return chain;
}

function tone(node: XrayNode): string {
  switch (node.status) {
    case 'blocked':
      return 'stroke-warn';
    case 'ok':
      return 'stroke-ok';
    case 'due':
      return 'stroke-foreground';
    case 'watch':
      return 'stroke-muted-foreground';
    default:
      return node.type === 'subject' || node.type === 'record' || node.type === 'money'
        ? 'stroke-brand'
        : 'stroke-border';
  }
}

/** One node, opened: the facts as the table holds them, and the door to the row itself. */
function EvidenceDrawer({
  node,
  subject,
  rules,
  onClose,
}: {
  node: XrayNode | null;
  subject: string;
  rules: Xray['rulesApplied'];
  onClose: () => void;
}) {
  // A check, a clearance or a transfer has no page of its own: it lives on the mare's record.
  const onTheMare = node?.recordRef ? /^(CLR|CHK|TR)-/.test(node.recordRef) : false;
  const href = node?.recordRef
    ? node.recordRef.startsWith('OX-')
      ? `/signals/${node.recordRef}`
      : (hrefFor(node.recordRef) ?? (onTheMare ? hrefFor(subject) : null))
    : null;
  return (
    <Sheet open={node !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]"
        data-testid="evidence-drawer"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-[14px]">{node?.label ?? ''}</SheetTitle>
          <SheetDescription className="text-[12px]">
            {node ? (
              <>
                {node.type} · {node.source}
                {node.sublabel ? <> · {node.sublabel}</> : null}
              </>
            ) : (
              ''
            )}
          </SheetDescription>
        </SheetHeader>
        {node ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
              {node.facts.map((fact) => (
                <div key={fact.key} className="contents">
                  <dt className="readout text-muted-foreground">{fact.key}</dt>
                  <dd className="break-words">{fact.value}</dd>
                </div>
              ))}
              {node.facts.length === 0 ? (
                <dd className="col-span-2 text-muted-foreground">No fields to show.</dd>
              ) : null}
              <dt className="readout text-muted-foreground">state</dt>
              <dd className={cn(node.status === 'blocked' ? 'text-warn' : node.status === 'ok' ? 'text-ok' : '')}>
                {node.status}
              </dd>
              {node.occurredAt ? (
                <>
                  <dt className="readout text-muted-foreground">recorded</dt>
                  <dd className="code">{node.occurredAt.slice(0, 10)}</dd>
                </>
              ) : null}
              {rules.map((rule) => (
                <div key={rule.code} className="contents">
                  <dt className="readout text-muted-foreground">rule</dt>
                  <dd>
                    <span className="code">{rule.code}</span>{' '}
                    <span className={cn('readout', rule.verdict === 'blocked' ? 'text-warn' : 'text-ok')}>
                      {rule.verdict}
                    </span>
                    {rule.reason ? (
                      <span className="block text-[12px] text-muted-foreground">{rule.reason}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
            {href ? (
              <Link
                href={href}
                className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-[12px] font-medium text-background hover:opacity-90"
                onClick={onClose}
              >
                Open {onTheMare && !hrefFor(node.recordRef ?? '') ? `${subject} · ${node.recordRef}` : node.recordRef}
              </Link>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {node.type === 'rule'
                  ? 'A rule in code, not a row: its verdict above is what it returned for these records.'
                  : node.type === 'gap'
                    ? 'Nothing on record yet: this node stands for what the rule looked for and did not find.'
                    : 'Derived from the rows around it.'}
              </p>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** A question handed to the assistant: an event for a page with a dock or palette, a link to the page that has one. */
function AskButton({
  ask,
  question,
  href,
  testId,
  children,
  primary = false,
}: {
  ask: XrayAsk | null;
  question: string;
  href: string | null;
  testId: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const className = cn(
    'pressable inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[11px]',
    primary ? 'border-foreground bg-foreground text-background hover:opacity-90' : 'hover:bg-muted',
  );
  if (!ask) return null;
  if (ask.kind === 'link')
    return href ? (
      <Link href={href} className={className} data-testid={testId}>
        {children}
      </Link>
    ) : null;
  return (
    <button type="button" onClick={() => askFromAnywhere(question)} className={className} data-testid={testId}>
      {children}
    </button>
  );
}

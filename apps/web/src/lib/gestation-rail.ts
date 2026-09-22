import { EXPECTED_FOALING_DAY, addDays, gestationDay } from '@daysheet/domain';
import type { RailNode } from '@/components/platform/rail';
import { barnDate, day, usd } from '@/lib/format';
import type { Story } from '@/lib/types';

/**
 * One mare's cycle as stations on a line: what the records say happened, what the rules say is
 * missing, what is only planned. Built on the server from the story the API already returns,
 * with the domain's own day arithmetic, so the rail never disagrees with the day sheet.
 *
 * The near stretch — everything up to a fortnight past today — takes most of the line at one
 * scale; foaling and the move North sit past a break at another, so the whole cycle fits
 * without crushing the days that matter.
 */
export interface GestationRail {
  nodes: RailNode[];
  now: number;
  nowLabel: string;
  breaks: number[];
  label: string;
}

interface Station {
  key: string;
  day: number;
  label: string;
  sub?: string;
  state: RailNode['state'];
}

const NEAR_HORIZON_DAYS = 14;
const NEAR_SHARE = 0.68;
const BREAK_GAP = 0.04;

const isOpen = (status: string) => status === 'OPEN' || status === 'ACKNOWLEDGED';

export function gestationRail(story: Story): GestationRail {
  const { transferredOn, gestationDay: today, nextMilestone, transferId } = story.pregnancy;
  const dayOf = (iso: string) => gestationDay(transferredOn, barnDate(iso));
  const open = (kind: string) => story.exceptions.some((x) => x.kind === kind && isOpen(x.status));
  const stations: Station[] = [];

  for (const row of story.rows) {
    if (row.kind === 'exception') continue;
    const at = dayOf(row.at);
    if (row.kind === 'planned') {
      stations.push({
        key: row.id,
        day: at,
        label: row.title.replace(/^Moves to the /, '').replace(/\s*·\s*about day \d+$/, ''),
        sub: `~day ${at} · planned`,
        state: 'planned',
      });
      continue;
    }
    const check = row.source === 'vet' ? /^Day (\d+) check: (.+)$/.exec(row.title) : null;
    if (check) {
      stations.push({
        key: row.id,
        day: at,
        label: `Day ${check[1]} · ${check[2]}`,
        sub: `${row.id} · ${day(row.at)}`,
        state: 'done',
      });
    } else if (row.source === 'billing' && row.amountCents !== undefined) {
      stations.push({
        key: row.id,
        day: at,
        label: usd(row.amountCents),
        sub: `${row.title.replace(' invoiced', '')} · ${day(row.at)}`,
        state: 'done',
      });
    } else if (row.source === 'recip farm') {
      stations.push({ key: row.id, day: at, label: row.title, sub: day(row.at), state: 'done' });
    }
  }

  // The transfer itself, when no row carries it (the rows are the API's; the pregnancy always has one).
  if (!stations.some((s) => s.key === transferId)) {
    const at = dayOf(transferredOn);
    stations.push({
      key: transferId,
      day: at,
      label: 'Transferred',
      sub: `${transferId} · ${day(transferredOn)}`,
      state: 'done',
    });
  }

  if (nextMilestone !== null) {
    const overdue = open('CHECK_OVERDUE');
    stations.push({
      key: `milestone-${nextMilestone}`,
      day: nextMilestone,
      label: `Day ${nextMilestone} check`,
      sub: overdue ? 'never recorded' : today >= nextMilestone ? 'due' : `in ${nextMilestone - today} days`,
      state: overdue ? 'blocked' : 'pending',
    });
  }

  for (const held of story.recip.heldFor) {
    const conflict = open('RECIPIENT_CONFLICT');
    const at = held.expectedOn ? dayOf(held.expectedOn) : today;
    stations.push({
      key: `held-${held.id}`,
      day: at,
      label: `Held for ${held.id}`,
      sub: `${held.expectedOn ? day(held.expectedOn) : 'no date'} · ${conflict ? 'she already carries one' : held.status.toLowerCase()}`,
      state: conflict ? 'blocked' : 'pending',
    });
  }

  if (story.recip.departure) {
    const { scheduledDepartureOn, rule } = story.recip.departure;
    const at = dayOf(scheduledDepartureOn);
    stations.push({
      key: 'departure',
      day: at,
      label: 'Leaves the farm',
      sub: `${day(scheduledDepartureOn)} · ${rule.ok ? 'confirmed in foal' : 'no video on record'}`,
      state: rule.ok ? (at <= today ? 'done' : 'pending') : 'blocked',
    });
  }

  // Foaling: the domain's planning estimate (A15), never a record — drawn as planned and said so.
  const foalingOn = addDays(transferredOn, EXPECTED_FOALING_DAY - dayOf(transferredOn));
  stations.push({
    key: 'foaling',
    day: EXPECTED_FOALING_DAY,
    label: 'Foaling',
    sub: `~day ${EXPECTED_FOALING_DAY} · ${day(foalingOn)} · assumption`,
    state: 'planned',
  });

  const horizon = today + NEAR_HORIZON_DAYS;
  const near = stations.filter((s) => s.day <= horizon);
  const far = stations.filter((s) => s.day > horizon);
  const d0 = Math.min(today, ...near.map((s) => s.day)) - 1;
  const dNear = Math.max(today, ...near.map((s) => s.day)) + 2;
  const dFar = far.length > 0 ? Math.max(...far.map((s) => s.day)) : dNear;
  const nearShare = far.length > 0 ? NEAR_SHARE : 1;
  const position = (d: number): number =>
    d <= dNear
      ? ((d - d0) / (dNear - d0)) * nearShare
      : nearShare + BREAK_GAP + ((d - dNear) / (dFar - dNear)) * (1 - nearShare - BREAK_GAP);

  return {
    nodes: stations.map((s) => ({ key: s.key, at: position(s.day), label: s.label, sub: s.sub, state: s.state })),
    now: position(today),
    nowLabel: `today · day ${today}`,
    breaks: far.length > 0 ? [nearShare + BREAK_GAP / 2] : [],
    label: `${story.recip.id}: day ${today} of about ${EXPECTED_FOALING_DAY}, the checks recorded, the check missing, the day she leaves, and foaling`,
  };
}

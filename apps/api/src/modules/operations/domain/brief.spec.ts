import { createHash } from 'node:crypto';
import {
  baselineFor,
  breakdown,
  contextOf,
  groupChanges,
  lookaheadDays,
  mine,
  rankForReader,
  rankNeedsYou,
  sortLookahead,
  stateIdOf,
  urgencyOf,
  type LookaheadItem,
} from './brief';

describe('the morning brief', () => {
  it('reads the board severity first, then the dollars held up, then the oldest row', () => {
    const rows = [
      { id: 'OX-1', severity: 'WARN', stakeCents: 900_000, createdAt: '2026-09-18T10:00:00.000Z' },
      { id: 'OX-2', severity: 'CRITICAL', stakeCents: null, createdAt: '2026-09-18T11:00:00.000Z' },
      { id: 'OX-3', severity: 'CRITICAL', stakeCents: 150_000, createdAt: '2026-09-18T12:00:00.000Z' },
      { id: 'OX-4', severity: 'CRITICAL', stakeCents: null, createdAt: '2026-09-18T09:00:00.000Z' },
      { id: 'OX-5', severity: 'INFO', stakeCents: 5_000_000, createdAt: '2026-09-18T08:00:00.000Z' },
    ];
    expect(rankNeedsYou(rows, 4).map((r) => r.id)).toEqual(['OX-3', 'OX-4', 'OX-2', 'OX-1']);
  });

  it('knows who is asking: the vet reads her own rows first, the founder owns them all', () => {
    const rows = [
      {
        id: 'OX-1',
        owner: 'BILLING',
        severity: 'CRITICAL',
        stakeCents: 900_000,
        createdAt: '2026-09-18T10:00:00.000Z',
      },
      { id: 'OX-2', owner: 'VET', severity: 'WARN', stakeCents: null, createdAt: '2026-09-18T11:00:00.000Z' },
      { id: 'OX-3', owner: 'VET', severity: 'CRITICAL', stakeCents: null, createdAt: '2026-09-18T12:00:00.000Z' },
      { id: 'OX-4', owner: 'RECIPS', severity: 'CRITICAL', stakeCents: null, createdAt: '2026-09-18T09:00:00.000Z' },
    ];
    expect(mine(rows, 'VET').map((r) => r.id)).toEqual(['OX-2', 'OX-3']);
    expect(mine(rows, 'ADMIN')).toHaveLength(4);
    // The vet's two first (critical before warning), then the rest of the board by the same rule.
    expect(rankForReader(rows, 'VET', 3).map((r) => r.id)).toEqual(['OX-3', 'OX-2', 'OX-1']);
    // The founder owns all four: severity, then the dollars, then age.
    expect(rankForReader(rows, 'ADMIN', 3).map((r) => r.id)).toEqual(['OX-1', 'OX-4', 'OX-3']);
  });

  it('counts the board by who takes the next step and by channel, and names urgency in one word', () => {
    const rows = [
      { owner: 'VET', channel: 'VETERINARY' },
      { owner: 'VET', channel: 'RECIPIENT' },
      { owner: 'BILLING', channel: 'SALE' },
    ];
    expect(breakdown(rows)).toEqual({
      byOwner: { VET: 2, BILLING: 1 },
      byChannel: { VETERINARY: 1, RECIPIENT: 1, SALE: 1 },
    });
    expect(breakdown([])).toEqual({ byOwner: {}, byChannel: {} });
    expect([urgencyOf('CRITICAL'), urgencyOf('WARN'), urgencyOf('INFO')]).toEqual(['now', 'today', 'watch']);
  });

  it('gives the same world the same state id, and a moved row a different one', () => {
    const sha = (text: string) => createHash('sha1').update(text).digest('hex');
    const a = [
      { id: 'OX-2', status: 'OPEN', stakeCents: 100 },
      { id: 'OX-1', status: 'OPEN', stakeCents: null },
    ];
    const b = [
      { id: 'OX-1', status: 'OPEN', stakeCents: null },
      { id: 'OX-2', status: 'OPEN', stakeCents: 100 },
    ];
    expect(stateIdOf(a, sha)).toBe(stateIdOf(b, sha));
    expect(stateIdOf(a, sha)).toHaveLength(12);
    expect(stateIdOf([{ ...a[0]!, status: 'ACKNOWLEDGED' }, a[1]!], sha)).not.toBe(stateIdOf(a, sha));
    expect(stateIdOf([{ ...a[0]!, stakeCents: 200 }, a[1]!], sha)).not.toBe(stateIdOf(a, sha));
  });

  it('takes the last snapshot before today began as yesterday, and none on the first day', () => {
    const points = [
      { id: 'a', takenAt: '2026-09-18T14:00:00.000Z', open: 4, atStakeCents: 0 },
      { id: 'b', takenAt: '2026-09-18T22:30:00.000Z', open: 5, atStakeCents: 100 },
      { id: 'c', takenAt: '2026-09-19T12:00:00.000Z', open: 6, atStakeCents: 200 },
    ];
    expect(baselineFor(points, '2026-09-19T05:00:00.000Z')?.id).toBe('b');
    expect(baselineFor(points, '2026-09-18T05:00:00.000Z')).toBeNull();
  });

  it('groups the trail by the context that owns each action and leaves the board heartbeat out', () => {
    const at = '2026-09-19T12:00:00.000Z';
    const groups = groupChanges([
      { action: 'payment.simulated', at },
      { action: 'payment.simulated', at: '2026-09-19T13:00:00.000Z' },
      { action: 'document.released', at },
      { action: 'invoice.amount_accepted_from_books', at },
      { action: 'clearance.recorded', at },
      { action: 'exceptions.detected', at },
      { action: 'exception.raised', at },
      { action: 'exception.acknowledged', at },
    ]);
    expect(groups.map((g) => [g.context, g.count])).toEqual([
      ['billing', 3],
      ['accounting', 1],
      ['board', 1],
      ['veterinary', 1],
    ]);
    const billing = groups[0]!;
    expect(billing.actions[0]).toEqual({
      action: 'payment.simulated',
      label: 'payment simulated',
      count: 2,
      last: '2026-09-19T13:00:00.000Z',
    });
    expect(contextOf('job.retried')).toBe('integrations');
    expect(contextOf('ask.review.decided')).toBe('assistant');
  });

  it('covers today and tomorrow, and puts the blocked thing first within a day', () => {
    expect(lookaheadDays('2026-04-20')).toEqual(['2026-04-20', '2026-04-21']);
    const items: LookaheadItem[] = [
      { on: '2026-04-21', kind: 'collection', label: 'Collection day', entityId: null, state: 'watch', note: '' },
      { on: '2026-04-20', kind: 'departure', label: 'R-0052 leaves', entityId: 'R-0052', state: 'ready', note: '' },
      {
        on: '2026-04-20',
        kind: 'embryo_expected',
        label: 'E-26-0071 arrives',
        entityId: 'E-26-0071',
        state: 'blocked',
        note: 'no recip set aside',
      },
      {
        on: '2026-04-20',
        kind: 'invoice_due',
        label: 'INV-26-0009 due',
        entityId: 'INV-26-0009',
        state: 'due',
        note: '',
      },
    ];
    expect(sortLookahead(items).map((i) => i.label)).toEqual([
      'E-26-0071 arrives',
      'INV-26-0009 due',
      'R-0052 leaves',
      'Collection day',
    ]);
  });
});

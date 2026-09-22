import { describe, expect, it } from 'vitest';
import { gestationRail } from './gestation-rail';
import type { Story, StoryRow } from './types';

const row = (partial: Partial<StoryRow> & Pick<StoryRow, 'id' | 'at' | 'source' | 'title'>): StoryRow => ({
  kind: 'event',
  evidenceIds: [partial.id],
  correlationId: null,
  ...partial,
});

/** The seeded mare, reduced to what the rail reads: day 48, the day-45 check missing, held and leaving. */
function seeded(overrides: Partial<Story['pregnancy']> = {}, today = '2026-04-20'): Story {
  return {
    today,
    recip: {
      id: 'R-0037',
      number: 37,
      status: 'CARRYING',
      name: 'Recip #37',
      clearances: [],
      clearance: { ok: false, evidenceIds: [], recipId: 'R-0037' },
      departure: {
        scheduledDepartureOn: '2026-04-22',
        rule: { ok: false, code: 'DEPARTURE_UNCONFIRMED', reason: 'no video', evidenceIds: ['R-0037'] },
      },
      heldFor: [{ id: 'E-26-0054', status: 'EXPECTED', expectedOn: '2026-04-21' }],
    },
    embryo: {
      id: 'E-26-0009',
      status: 'PREGNANT',
      source: 'ICSI',
      cross: 'x',
      customer: { id: 'C-1', name: 'x' },
      contract: null,
    },
    pregnancy: {
      transferId: 'TR-26-0037',
      transferredOn: '2026-03-10',
      gestationDay: 48,
      lastCheck: { id: 'CHK-26-0077', day: 24, result: 'HEARTBEAT', on: '2026-03-27' },
      nextMilestone: 45,
      ...overrides,
    },
    money: { invoices: [], stripe: null, books: [], jobs: [] },
    exceptions: [
      {
        id: 'OX-1',
        kind: 'CHECK_OVERDUE',
        severity: 'WARN',
        status: 'OPEN',
        title: '',
        entityId: null,
        correlationId: null,
        rule: null,
        detail: null,
      },
      {
        id: 'OX-2',
        kind: 'RECIPIENT_CONFLICT',
        severity: 'WARN',
        status: 'OPEN',
        title: '',
        entityId: null,
        correlationId: null,
        rule: null,
        detail: null,
      },
    ],
    freeRecip: null,
    rows: [
      row({
        id: 'INV-26-0075',
        at: '2026-02-08T12:00:00.000Z',
        source: 'billing',
        title: 'recip deposit invoiced — paid',
        amountCents: 100_000,
      }),
      row({ id: 'ASP-26-0008', at: '2026-03-02T15:00:00.000Z', source: 'vet', title: 'Aspirated from Little Clover' }),
      row({
        id: 'TR-26-0037',
        at: '2026-03-10T16:00:00.000Z',
        source: 'recip farm',
        title: 'Transferred into Recip #37',
      }),
      row({ id: 'CHK-26-0076', at: '2026-03-17T15:00:00.000Z', source: 'vet', title: 'Day 14 check: pregnant' }),
      row({ id: 'CHK-26-0077', at: '2026-03-27T15:00:00.000Z', source: 'vet', title: 'Day 24 check: heartbeat' }),
      row({
        id: 'OX-1',
        at: '2026-04-20T23:22:25.846Z',
        source: 'vet',
        kind: 'exception',
        title: 'the day-45 check was never recorded',
      }),
      row({
        id: 'TR-26-0037:north',
        at: '2027-01-04T12:00:00.000Z',
        source: 'recip farm',
        kind: 'planned',
        title: 'Moves to the North facility for foaling · about day 300',
      }),
    ],
  };
}

describe('the gestation rail', () => {
  it('draws the records as done, the missing check and the blocked departure as blocked, and the future as planned', () => {
    const rail = gestationRail(seeded());
    const byKey = Object.fromEntries(rail.nodes.map((n) => [n.key, n]));
    expect(byKey['CHK-26-0076']).toMatchObject({ label: 'Day 14 · pregnant', state: 'done' });
    expect(byKey['milestone-45']).toMatchObject({ label: 'Day 45 check', sub: 'never recorded', state: 'blocked' });
    expect(byKey['departure']).toMatchObject({ state: 'blocked', sub: 'Apr 22 · no video on record' });
    expect(byKey['held-E-26-0054']).toMatchObject({ state: 'blocked' });
    expect(byKey['TR-26-0037:north']).toMatchObject({ label: 'North facility for foaling', state: 'planned' });
    expect(byKey['foaling']).toMatchObject({ state: 'planned', sub: '~day 340 · Feb 6 · assumption' });
    // Aspiration and exceptions are not stations; the transfer row is, once.
    expect(byKey['ASP-26-0008']).toBeUndefined();
    expect(byKey['OX-1']).toBeUndefined();
    expect(rail.nodes.filter((n) => n.key === 'TR-26-0037')).toHaveLength(1);
  });

  it('keeps time in order, puts today between the missing check and the departure, and breaks before the far end', () => {
    const rail = gestationRail(seeded());
    const at = (key: string) => rail.nodes.find((n) => n.key === key)!.at;
    expect(at('INV-26-0075')).toBeLessThan(at('TR-26-0037'));
    expect(at('TR-26-0037')).toBeLessThan(at('CHK-26-0076'));
    expect(at('milestone-45')).toBeLessThan(rail.now);
    expect(rail.now).toBeLessThan(at('held-E-26-0054'));
    expect(at('held-E-26-0054')).toBeLessThan(at('departure'));
    expect(rail.breaks).toHaveLength(1);
    expect(at('departure')).toBeLessThan(rail.breaks[0]!);
    expect(rail.breaks[0]!).toBeLessThan(at('TR-26-0037:north'));
    expect(at('foaling')).toBe(1);
    expect(rail.nowLabel).toBe('today · day 48');
    for (const n of rail.nodes) expect(n.at).toBeGreaterThanOrEqual(0);
  });

  it('adds the transfer when no row carries it, and needs no break once nothing lies past the horizon', () => {
    const story = seeded({ gestationDay: 335, nextMilestone: null }, '2027-02-01');
    story.rows = story.rows.filter((r) => r.id !== 'TR-26-0037');
    story.recip.heldFor = [];
    story.recip.departure = null;
    story.exceptions = [];
    const rail = gestationRail(story);
    expect(rail.nodes.find((n) => n.key === 'TR-26-0037')).toMatchObject({ label: 'Transferred', state: 'done' });
    expect(rail.breaks).toEqual([]);
    expect(rail.nodes.find((n) => n.key === 'foaling')!.at).toBeGreaterThan(rail.now);
  });

  it('marks the next check as due or ahead when nothing is overdue', () => {
    const story = seeded({ gestationDay: 40 }, '2026-04-12');
    story.exceptions = [];
    expect(gestationRail(story).nodes.find((n) => n.key === 'milestone-45')).toMatchObject({
      state: 'pending',
      sub: 'in 5 days',
    });
    const due = seeded({ gestationDay: 46 }, '2026-04-18');
    due.exceptions = [];
    expect(gestationRail(due).nodes.find((n) => n.key === 'milestone-45')).toMatchObject({
      state: 'pending',
      sub: 'due',
    });
  });
});

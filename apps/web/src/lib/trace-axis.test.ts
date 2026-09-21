import { describe, expect, it } from 'vitest';
import { axisFor, formatOffset, isOpen } from './trace-axis';
import type { TraceStep } from './types';

const step = (over: Partial<TraceStep> & Pick<TraceStep, 'at' | 'kind' | 'label'>): TraceStep => ({
  until: null,
  ref: 'X-1',
  ok: null,
  detail: null,
  ...over,
});

describe('the trace axis', () => {
  it('lays rows out from the first instant, keeps spans, and stretches an open row to the end', () => {
    const axis = axisFor([
      step({ at: '2026-09-19T10:00:00.000Z', kind: 'audit', label: 'payment.simulated' }),
      step({
        at: '2026-09-19T10:00:00.040Z',
        kind: 'event',
        label: 'PaymentSucceeded',
        until: '2026-09-19T10:00:00.120Z',
        ok: true,
      }),
      step({
        at: '2026-09-19T10:00:00.150Z',
        kind: 'job',
        label: 'qbo-sync dead',
        until: '2026-09-19T10:00:03.000Z',
        ok: false,
      }),
      step({ at: '2026-09-19T10:00:03.100Z', kind: 'exception', label: 'SYNC_FAILED open' }),
    ]);
    expect(axis).not.toBeNull();
    expect(axis!.spanMs).toBe(3_100);
    expect(axis!.rows.map((r) => [r.kind, r.end === null ? null : r.end - axis!.t0, r.open])).toEqual([
      ['audit', null, false],
      ['event', 120, false],
      ['job', 3_000, false],
      ['exception', null, true],
    ]);
    expect(axis!.ticks.map((t) => t.label)).toEqual(['+0 ms', '+1.0 s', '+2.1 s', '+3.1 s']);
  });

  it('needs two rows and gives a single instant a one-second scale', () => {
    expect(axisFor([step({ at: '2026-09-19T10:00:00.000Z', kind: 'audit', label: 'a' })])).toBeNull();
    const axis = axisFor([
      step({ at: '2026-09-19T10:00:00.000Z', kind: 'audit', label: 'a' }),
      step({ at: '2026-09-19T10:00:00.000Z', kind: 'audit', label: 'b' }),
    ]);
    expect(axis?.spanMs).toBe(1_000);
  });

  it('reads an open row from its status, not its kind', () => {
    expect(isOpen({ kind: 'exception', label: 'PAPERS_HELD open', until: null })).toBe(true);
    expect(isOpen({ kind: 'exception', label: 'PAPERS_HELD resolved', until: null })).toBe(false);
    expect(isOpen({ kind: 'job', label: 'qbo-sync retrying', until: null })).toBe(true);
    expect(isOpen({ kind: 'job', label: 'qbo-sync completed', until: null })).toBe(false);
    expect(isOpen({ kind: 'event', label: 'LotSold', until: null })).toBe(false);
  });

  it('picks the unit a reader would', () => {
    expect(formatOffset(0)).toBe('+0 ms');
    expect(formatOffset(340)).toBe('+340 ms');
    expect(formatOffset(2_140)).toBe('+2.1 s');
    expect(formatOffset(192_000)).toBe('+3 min 12 s');
    expect(formatOffset(3_900_000)).toBe('+1 h 05 min');
  });
});

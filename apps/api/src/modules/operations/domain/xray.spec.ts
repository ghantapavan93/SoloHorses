import { xrayFor, type XrayInput } from './xray';

const base = (): XrayInput => ({
  today: '2026-04-20',
  asOf: '2026-04-20T12:00:00.000Z',
  recip: {
    id: 'R-0037',
    number: 37,
    status: 'CARRYING',
    clearances: [],
    departure: {
      scheduledDepartureOn: '2026-04-22',
      rule: {
        ok: false,
        code: 'DEPARTURE_VIDEO_MISSING',
        reason: 'no video-confirmed in-foal check within 3 days of departure',
        evidenceIds: ['R-0037'],
      },
    },
  },
  embryo: { id: 'E-26-0009', status: 'PREGNANT', cross: 'Sire x Dam', customer: { name: 'A Client' } },
  pregnancy: {
    transferId: 'TR-26-0001',
    transferredOn: '2026-03-03',
    gestationDay: 48,
    lastCheck: { id: 'CHK-26-0010', day: 24, result: 'HEARTBEAT', on: '2026-03-27' },
    nextMilestone: 45,
  },
  money: {
    invoices: [
      {
        id: 'INV-26-0001',
        kind: 'LEASE_FEE',
        status: 'PAID',
        amountCents: 500_000,
        payments: [{ id: 'PAY-26-0001', status: 'SUCCEEDED', amountCents: 500_000 }],
      },
    ],
    books: [{ entityId: 'INV-26-0001', status: 'SYNCED', lastError: null }],
  },
  signals: [
    {
      id: 'OX-26-0005',
      kind: 'DEPARTURE_UNCONFIRMED',
      label: 'Recip leaving: not video-confirmed in foal',
      severity: 'CRITICAL',
      source: 'VETERINARY',
      title: 'R-0037 leaves in 2 days without a video',
      entityId: 'R-0037',
      rule: 'DEPARTURE_VIDEO_MISSING',
      state: [{ key: 'leaves', value: '2026-04-22' }],
      meaning: 'She cannot leave until the vet records a video-confirmed in-foal check.',
      owner: 'VET',
      next: 'Route to vet',
      stakeCents: null,
      createdAt: '2026-04-20T06:00:00.000Z',
    },
    {
      id: 'OX-26-0002',
      kind: 'CHECK_OVERDUE',
      label: 'Pregnancy check overdue',
      severity: 'WARN',
      source: 'VETERINARY',
      title: 'day-45 check missing',
      entityId: 'E-26-0009',
      rule: 'CHECK_OVERDUE',
      state: [{ key: 'due', value: 'day 45' }],
      meaning: 'The day-45 check is three days late.',
      owner: 'VET',
      next: 'Schedule the check',
      stakeCents: null,
      createdAt: '2026-04-19T06:00:00.000Z',
    },
  ],
});

describe('the operational x-ray', () => {
  it('draws the chain from the mare to the person, with the lease rule and the missing video on it', () => {
    const xray = xrayFor(base());
    const ids = xray.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'record:R-0037',
        'record:E-26-0009',
        'record:TR-26-0001',
        'record:CHK-26-0010',
        'gap:check',
        'fact:departure',
        'gap:video',
        'rule:departure',
        'record:INV-26-0001',
        'signal:OX-26-0005',
        'signal:OX-26-0002',
        'decision',
      ]),
    );
    expect(xray.blockId).toBe('signal:OX-26-0005');
    expect(xray.unresolvedBoundary).toMatchObject({
      owner: 'VET',
      next: 'Route to vet',
      signalId: 'OX-26-0005',
      source: 'VETERINARY',
    });
    expect(xray.unresolvedBoundary?.reason).toContain('veterinary judgment');
    expect(xray.conclusion).toBe('She cannot leave until the vet records a video-confirmed in-foal check.');
    expect(xray.edges.map((e) => `${e.from} ${e.relation} ${e.to}`)).toEqual(
      expect.arrayContaining([
        'record:R-0037 carries record:E-26-0009',
        'gap:video read by rule:departure',
        'rule:departure raised signal:OX-26-0005',
        'gap:check raised signal:OX-26-0002',
        'signal:OX-26-0005 waits for decision',
      ]),
    );
    expect(xray.rulesApplied.map((r) => [r.code, r.verdict])).toEqual([
      ['DEPARTURE_VIDEO_MISSING', 'blocked'],
      ['CHECK_OVERDUE', 'blocked'],
    ]);
    expect(xray.nodes.find((n) => n.id === 'decision')?.label).toBe('vet decides');
    expect(xray.nodes.every((n) => n.w > 0 && n.h > 0)).toBe(true);
  });

  it('is clear when the video is on record and nothing is open', () => {
    const input = base();
    input.recip.clearances = [
      { id: 'CLR-26-0031', kind: 'VIDEO_IN_FOAL', result: 'IN_FOAL', performedOn: '2026-04-20', expiresOn: null },
    ];
    input.recip.departure = {
      scheduledDepartureOn: '2026-04-22',
      rule: { ok: true, evidenceIds: ['R-0037', 'CLR-26-0031'] },
    };
    input.pregnancy.nextMilestone = 55;
    input.signals = [];
    const xray = xrayFor(input);
    expect(xray.blockId).toBeNull();
    expect(xray.unresolvedBoundary).toBeNull();
    expect(xray.nodes.find((n) => n.id === 'record:CLR-26-0031')?.status).toBe('ok');
    expect(xray.nodes.some((n) => n.id === 'gap:video' || n.id === 'gap:check')).toBe(false);
    expect(xray.rulesApplied).toEqual([
      {
        code: 'DEPARTURE_OK',
        label: 'DepartureRule',
        verdict: 'ok',
        reason: null,
        evidenceIds: ['R-0037', 'CLR-26-0031'],
      },
    ]);
    expect(xray.conclusion).toContain('nothing about her waits on a person');
  });

  it('fingerprints the facts it drew, so the same state hashes the same and a new check does not', () => {
    const a = xrayFor(base());
    const b = xrayFor(base());
    expect(a.stateHash).toBe(b.stateHash);
    const changed = base();
    changed.pregnancy.lastCheck = { id: 'CHK-26-0011', day: 45, result: 'HEARTBEAT', on: '2026-04-20' };
    changed.pregnancy.nextMilestone = 55;
    expect(xrayFor(changed).stateHash).not.toBe(a.stateHash);
  });
});

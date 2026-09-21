import { signalMap } from './map';

/** The map is the explanation, drawn: records → facts → the rule → the block → the person, left to right. */
describe('signalMap: why this one', () => {
  const held = signalMap({
    id: 'OX-26-0003',
    label: 'Registration papers held',
    entityId: 'DOC-26-0001',
    detail: {
      code: 'SETTLEMENT_PROCESSING',
      policy: 'RegistrationReleasePolicy v1',
      evidenceIds: ['LOT-26-0041', 'INV-26-0077', 'PAY-26-0064', 'DOC-26-0001'],
    },
    systemState: [
      { key: 'payment.method', value: 'ach' },
      { key: 'payment.status', value: 'processing' },
      { key: 'document.status', value: 'held' },
      { key: 'rule', value: 'RegistrationReleasePolicy v1' },
    ],
    next: 'Hold papers',
    owner: 'BILLING',
  });

  it('draws the record, the cited records, the facts, the rule, the block and the decision', () => {
    const kinds = held.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'record')).toHaveLength(4); // the document and three cited records
    expect(kinds.filter((k) => k === 'fact')).toHaveLength(3);
    expect(held.nodes.find((n) => n.kind === 'rule')?.label).toBe('RegistrationReleasePolicy v1');
    expect(held.nodes.find((n) => n.id === held.blockId)).toMatchObject({
      kind: 'gap',
      label: 'Registration papers held',
      sublabel: 'OX-26-0003',
    });
    expect(held.nodes.find((n) => n.kind === 'decision')).toMatchObject({
      label: 'Hold papers',
      sublabel: 'billing decides',
    });
    expect(held.nodes.find((n) => n.id === 'record:INV-26-0077')?.recordId).toBe('INV-26-0077');
  });

  it('lays the chain out left to right with every edge pointing forward', () => {
    const at = (id: string) => held.nodes.find((n) => n.id === id)!;
    for (const edge of held.edges) expect(at(edge.to).x).toBeGreaterThan(at(edge.from).x);
    const record = at('record:DOC-26-0001');
    const fact = at('fact:payment.status');
    const rule = at('rule');
    const gap = at(held.blockId);
    const decision = at('decision');
    expect(record.x).toBeLessThan(fact.x);
    expect(fact.x).toBeLessThan(rule.x);
    expect(rule.x).toBeLessThan(gap.x);
    expect(gap.x).toBeLessThan(decision.x);
    expect(held.width).toBeGreaterThan(decision.x);
    expect(held.height).toBeGreaterThan(0);
    for (const node of held.nodes) expect(node.x).toBeGreaterThanOrEqual(0);
  });

  it('links the record straight to the rule when the explanation has no facts, and falls back to the detector code', () => {
    const bare = signalMap({
      id: 'OX-1',
      label: 'Job dead-lettered',
      entityId: null,
      detail: { code: 'JOB_DEAD' },
      systemState: [],
      next: 'Retry the job',
      owner: 'ADMIN',
    });
    expect(bare.edges.map((e) => e.id)).toEqual(['record:OX-1->rule', 'rule->gap:OX-1', 'gap:OX-1->decision']);
    expect(bare.nodes.find((n) => n.kind === 'rule')?.label).toBe('JOB_DEAD');
  });
});

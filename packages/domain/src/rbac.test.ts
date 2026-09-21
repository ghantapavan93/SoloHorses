import { describe, expect, it } from 'vitest';
import { can, canSeeRecord, readableResources, type Actor, type Resource } from './rbac';

const jane: Actor = { userId: 'usr_jane', role: 'CUSTOMER', customerId: 'C-0001' };
const vet: Actor = { userId: 'usr_vet', role: 'VET', customerId: null };

describe('rbac: a client reads her own rows and nothing else', () => {
  it('lets a customer read her own record, her embryos and her money — and write only memory', () => {
    for (const r of [
      'customer',
      'horse',
      'contract',
      'embryo',
      'transfer',
      'check',
      'invoice',
      'payment',
      'memory',
    ] as const)
      expect(can(jane, 'read', r)).toBe(true);
    for (const r of ['operations', 'platform', 'accounting', 'audit', 'evals', 'intake', 'semenOrder'] as const)
      expect(can(jane, 'read', r)).toBe(false);
    expect(can(jane, 'write', 'memory')).toBe(true);
    expect(can(jane, 'write', 'embryo')).toBe(false);
  });

  it('holds the row-level line: her own customer id, never another', () => {
    expect(canSeeRecord(jane, 'customer', { customerId: 'C-0001' })).toBe(true);
    expect(canSeeRecord(jane, 'customer', { customerId: 'C-0002' })).toBe(false);
    expect(canSeeRecord(jane, 'embryo', { customerId: null })).toBe(false);
    expect(canSeeRecord(vet, 'embryo', { customerId: 'C-0002' })).toBe(true);
  });

  it('keeps the board and the platform for staff', () => {
    expect(can(vet, 'read', 'operations')).toBe(true);
    expect(can(vet, 'write', 'check')).toBe(true);
    expect(can(vet, 'write', 'invoice')).toBe(false);
  });

  // Mutation survivors: whole role rows could be emptied without a test noticing, and the staff
  // half of canSeeRecord could skip the role check.
  it('each department writes its own records and reads by department; an admin writes everything', () => {
    const staff = (role: Actor['role']): Actor => ({ userId: `usr_${role.toLowerCase()}`, role, customerId: null });
    const writes: Record<Exclude<Actor['role'], 'CUSTOMER'>, [Resource[], Resource[]]> = {
      ADMIN: [['customer', 'horse', 'check', 'invoice', 'payment', 'accounting', 'platform', 'audit', 'evals'], []],
      STALLION_OFFICE: [
        ['contract', 'semenOrder', 'intake', 'operations'],
        ['check', 'invoice', 'payment', 'embryo'],
      ],
      RECIPS: [
        ['embryo', 'transfer', 'intake', 'operations'],
        ['check', 'invoice', 'contract', 'customer'],
      ],
      VET: [
        ['check', 'operations'],
        ['embryo', 'transfer', 'invoice', 'contract'],
      ],
      BILLING: [
        ['invoice', 'payment', 'accounting', 'operations'],
        ['check', 'embryo', 'transfer', 'contract'],
      ],
    };
    for (const [role, [yes, no]] of Object.entries(writes) as [
      Exclude<Actor['role'], 'CUSTOMER'>,
      [Resource[], Resource[]],
    ][]) {
      for (const r of yes) expect(can(staff(role), 'write', r), `${role} writes ${r}`).toBe(true);
      for (const r of no) expect(can(staff(role), 'write', r), `${role} does not write ${r}`).toBe(false);
    }
    expect(can(staff('RECIPS'), 'read', 'invoice')).toBe(false);
    expect(can(staff('STALLION_OFFICE'), 'read', 'invoice')).toBe(true);
    expect(can(staff('STALLION_OFFICE'), 'read', 'payment')).toBe(false);
    expect(can(staff('BILLING'), 'read', 'audit')).toBe(true);
  });

  it('a staff member outside the department does not see the row either, and the assistant’s citable set follows the same matrix', () => {
    expect(canSeeRecord(vet, 'invoice', { customerId: 'C-0001' })).toBe(false);
    expect(canSeeRecord(vet, 'check', { customerId: 'C-0001' })).toBe(true);
    expect(readableResources(vet)).not.toContain('invoice');
    expect(readableResources(vet)).toContain('check');
    expect(readableResources(jane)).not.toContain('operations');
    expect(readableResources(jane)).toContain('invoice');
  });
});

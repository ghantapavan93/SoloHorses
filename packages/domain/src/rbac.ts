/**
 * Who may see what. Enforced at the tool/service layer, never only in the UI.
 *
 * Customers see their own horses, embryos, contracts and invoices. Staff see by department.
 * Money is visible to billing and admins only; the assistant inherits the same matrix, so a
 * recips user asking "what does Jane owe?" gets an ACCESS_DENIED abstention, not a number.
 */

export type Role = 'ADMIN' | 'STALLION_OFFICE' | 'RECIPS' | 'VET' | 'BILLING' | 'CUSTOMER';

export type Resource =
  | 'customer'
  | 'horse'
  | 'contract'
  | 'semenOrder'
  | 'embryo'
  | 'transfer'
  | 'check'
  | 'invoice'
  | 'payment'
  | 'accounting'
  | 'intake'
  | 'audit'
  | 'evals'
  | 'memory'
  // Operational exceptions: every staff role sees and works them; customers never do.
  | 'operations'
  // Platform internals (jobs, events, breakers, cache, the lab): staff read, admins act.
  | 'platform';

export type Action = 'read' | 'write';

const STAFF_READ: Record<Exclude<Role, 'CUSTOMER'>, ReadonlySet<Resource>> = {
  ADMIN: new Set<Resource>([
    'customer',
    'horse',
    'contract',
    'semenOrder',
    'embryo',
    'transfer',
    'check',
    'invoice',
    'payment',
    'accounting',
    'intake',
    'audit',
    'evals',
    'memory',
    'operations',
    'platform',
  ]),
  STALLION_OFFICE: new Set<Resource>([
    'customer',
    'horse',
    'contract',
    'semenOrder',
    'embryo',
    'transfer',
    'check',
    'invoice',
    'intake',
    'memory',
    'operations',
    'platform',
  ]),
  RECIPS: new Set<Resource>([
    'customer',
    'horse',
    'embryo',
    'transfer',
    'check',
    'intake',
    'memory',
    'operations',
    'platform',
  ]),
  VET: new Set<Resource>(['customer', 'horse', 'embryo', 'transfer', 'check', 'memory', 'operations', 'platform']),
  BILLING: new Set<Resource>([
    'customer',
    'horse',
    'contract',
    'embryo',
    'transfer',
    'check',
    'invoice',
    'payment',
    'accounting',
    'audit',
    'memory',
    'operations',
    'platform',
  ]),
};

const STAFF_WRITE: Record<Exclude<Role, 'CUSTOMER'>, ReadonlySet<Resource>> = {
  ADMIN: STAFF_READ.ADMIN,
  STALLION_OFFICE: new Set<Resource>(['contract', 'semenOrder', 'intake', 'memory', 'operations']),
  RECIPS: new Set<Resource>(['embryo', 'transfer', 'intake', 'memory', 'operations']),
  VET: new Set<Resource>(['check', 'memory', 'operations']),
  BILLING: new Set<Resource>(['invoice', 'payment', 'accounting', 'memory', 'operations']),
};

// A client reads her own record and what hangs off it; the services hold the row-level line
// (`getCustomer` refuses another id, `listCustomers` refuses the role).
const CUSTOMER_READ: ReadonlySet<Resource> = new Set<Resource>([
  'customer',
  'horse',
  'contract',
  'embryo',
  'transfer',
  'check',
  'invoice',
  'payment',
  'memory',
]);

export interface Actor {
  userId: string;
  role: Role;
  /** Set for CUSTOMER actors; scopes every read to their own records. */
  customerId: string | null;
}

export interface OwnedRecord {
  customerId: string | null;
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  if (actor.role === 'CUSTOMER') {
    return action === 'read' ? CUSTOMER_READ.has(resource) : resource === 'memory';
  }
  const table = action === 'read' ? STAFF_READ : STAFF_WRITE;
  return table[actor.role].has(resource);
}

/** Row-level check for customer actors: the record must belong to them. */
export function canSeeRecord(actor: Actor, resource: Resource, record: OwnedRecord): boolean {
  if (!can(actor, 'read', resource)) return false;
  if (actor.role !== 'CUSTOMER') return true;
  return actor.customerId !== null && record.customerId === actor.customerId;
}

/** Resources that the assistant may ever cite for this actor. Used to filter tool output. */
export function readableResources(actor: Actor): Resource[] {
  const all: Resource[] = [
    'customer',
    'horse',
    'contract',
    'semenOrder',
    'embryo',
    'transfer',
    'check',
    'invoice',
    'payment',
    'accounting',
    'intake',
    'audit',
    'evals',
    'memory',
    'operations',
    'platform',
  ];
  return all.filter((r) => can(actor, 'read', r));
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  STALLION_OFFICE: 'Stallion office',
  RECIPS: 'Recip farm',
  VET: 'Veterinary',
  BILLING: 'Billing',
  CUSTOMER: 'Customer',
};

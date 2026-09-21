import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EnvService } from '../../../platform/config/env.module';
import {
  AccountingRateLimitError,
  AccountingTransientError,
  AccountingValidationError,
  assertReferenceLength,
  type AccountingProvider,
  type CreateCreditInput,
  type CreateCustomerInput,
  type CreateInvoiceInput,
  type CreatePaymentInput,
  type RemoteCredit,
  type RemoteCustomer,
  type RemoteInvoice,
  type RemoteItem,
  type RemotePayment,
} from './accounting.provider';

/**
 * A stand-in for the accounting system with the same failure modes as the real one.
 * State lives in the SimulatorRecord table so it survives restarts and can be shown in
 * the UI as "what the books say". Faults are injected through QBO_SIM_FAULTS:
 *
 *   429x2          the first two calls are throttled (retry-after 2s)
 *   500x1          one transient failure
 *   outage         every call fails with a 503 until `restore()` — the circuit-breaker scenario
 *   stale:INV-…    the next update to that invoice fails with a stale SyncToken (5010)
 *   dupname        the next customer create fails as a duplicate name (6240)
 *
 * "Tamper" edits the stored remote value directly — that is how a reconciliation
 * discrepancy is produced on purpose.
 */
@Injectable()
export class QboSimulator implements AccountingProvider {
  readonly mode = 'simulated' as const;
  readonly label = 'Accounting simulator (no sandbox connected)';
  private readonly logger = new Logger(QboSimulator.name);
  private faults: { kind: string; remaining: number; target?: string }[] = [];
  private calls = 0;

  constructor(
    private readonly prisma: PrismaService,
    envService: EnvService,
  ) {
    this.loadFaults(envService.env.QBO_SIM_FAULTS);
  }

  loadFaults(spec: string): void {
    this.faults = spec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((token) => {
        const throttled = /^429x(\d+)$/.exec(token);
        if (throttled) return { kind: '429', remaining: Number(throttled[1]) };
        const transient = /^500x(\d+)$/.exec(token);
        if (transient) return { kind: '500', remaining: Number(transient[1]) };
        const stale = /^stale:(.+)$/.exec(token);
        if (stale) return { kind: 'stale', remaining: 1, target: stale[1] };
        if (token === 'dupname') return { kind: 'dupname', remaining: 1 };
        if (token === 'outage') return { kind: 'outage', remaining: Number.MAX_SAFE_INTEGER };
        return { kind: 'unknown', remaining: 0 };
      })
      .filter((f) => f.remaining > 0);
    if (this.faults.length > 0) this.logger.warn(`simulator faults armed: ${spec}`);
  }

  armFault(spec: string): void {
    this.loadFaults(spec);
  }

  /** Clears every armed fault, including an outage. */
  restore(): void {
    this.faults = [];
  }

  /** What is armed right now, for the UI and the lab. */
  armedFaults(): { kind: string; remaining: number | 'until restored'; target?: string }[] {
    return this.faults
      .filter((f) => f.remaining > 0)
      .map((f) => ({
        kind: f.kind,
        remaining: f.kind === 'outage' ? ('until restored' as const) : f.remaining,
        ...(f.target ? { target: f.target } : {}),
      }));
  }

  private async maybeFail(kind: 'any' | 'update' | 'customer', target?: string): Promise<void> {
    this.calls += 1;
    await new Promise((r) => setTimeout(r, 40)); // a little latency, like a real API
    for (const fault of this.faults) {
      if (fault.remaining <= 0) continue;
      if (fault.kind === 'outage')
        throw new AccountingTransientError(
          'simulated outage: the accounting API is not responding (503)',
          `sim-tid-${this.calls}`,
        );
      if (fault.kind === '429') {
        fault.remaining -= 1;
        throw new AccountingRateLimitError(2_000, `sim-tid-${this.calls}`);
      }
      if (fault.kind === '500') {
        fault.remaining -= 1;
        throw new AccountingTransientError('simulated 500 from the accounting API', `sim-tid-${this.calls}`);
      }
      if (fault.kind === 'stale' && kind === 'update' && fault.target === target) {
        fault.remaining -= 1;
        throw new AccountingValidationError(
          '5010',
          'Stale Object Error: you are trying to update an object that has changed',
          `sim-tid-${this.calls}`,
        );
      }
      if (fault.kind === 'dupname' && kind === 'customer') {
        fault.remaining -= 1;
        throw new AccountingValidationError('6240', 'Duplicate Name Exists Error', `sim-tid-${this.calls}`);
      }
    }
  }

  private get db() {
    return this.prisma.client;
  }

  private async put<T extends { id: string }>(entityType: string, record: T, docNumber?: string): Promise<T> {
    await this.db.simulatorRecord.upsert({
      where: { provider_entityType_externalId: { provider: 'QBO', entityType, externalId: record.id } },
      create: {
        provider: 'QBO',
        entityType,
        externalId: record.id,
        docNumber: docNumber ?? null,
        data: record as never,
      },
      update: { docNumber: docNumber ?? null, data: record as never },
    });
    return record;
  }

  private async byDoc<T>(entityType: string, docNumber: string): Promise<T | null> {
    const row = await this.db.simulatorRecord.findFirst({ where: { provider: 'QBO', entityType, docNumber } });
    return row ? (row.data as unknown as T) : null;
  }

  private async nextId(entityType: string): Promise<string> {
    const count = await this.db.simulatorRecord.count({ where: { provider: 'QBO', entityType } });
    return `${entityType.slice(0, 3).toLowerCase()}_${String(count + 1).padStart(4, '0')}`;
  }

  async findCustomerByName(displayName: string): Promise<RemoteCustomer | null> {
    await this.maybeFail('any');
    return this.byDoc<RemoteCustomer>('CUSTOMER', displayName);
  }

  async createCustomer(input: CreateCustomerInput): Promise<RemoteCustomer> {
    await this.maybeFail('customer');
    return this.put(
      'CUSTOMER',
      { id: await this.nextId('CUSTOMER'), displayName: input.displayName, syncToken: '0' },
      input.displayName,
    );
  }

  async ensureItem(name: string): Promise<RemoteItem> {
    await this.maybeFail('any');
    const existing = await this.byDoc<RemoteItem>('ITEM', name);
    return existing ?? this.put('ITEM', { id: await this.nextId('ITEM'), name }, name);
  }

  async findInvoiceByDocNumber(docNumber: string): Promise<RemoteInvoice | null> {
    await this.maybeFail('any');
    return this.byDoc<RemoteInvoice>('INVOICE', docNumber);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<RemoteInvoice> {
    await this.maybeFail('any');
    assertReferenceLength(input.docNumber);
    const record: RemoteInvoice = {
      id: await this.nextId('INVOICE'),
      docNumber: input.docNumber,
      customerId: input.customerId,
      totalCents: input.amountCents,
      balanceCents: input.amountCents,
      syncToken: '0',
      txnDate: input.txnDate,
      dueDate: input.dueDate,
    };
    return this.put('INVOICE', record, input.docNumber);
  }

  async updateInvoiceAmount(id: string, syncToken: string, amountCents: number): Promise<RemoteInvoice> {
    const row = await this.db.simulatorRecord.findUnique({
      where: { provider_entityType_externalId: { provider: 'QBO', entityType: 'INVOICE', externalId: id } },
    });
    if (!row) throw new AccountingValidationError('610', 'Object Not Found', null);
    const current = row.data as unknown as RemoteInvoice;
    await this.maybeFail('update', current.docNumber);
    if (current.syncToken !== syncToken) throw new AccountingValidationError('5010', 'Stale Object Error', null);
    const paid = current.totalCents - current.balanceCents;
    const updated: RemoteInvoice = {
      ...current,
      totalCents: amountCents,
      balanceCents: Math.max(0, amountCents - paid),
      syncToken: String(Number(syncToken) + 1),
    };
    return this.put('INVOICE', updated, current.docNumber);
  }

  async findPaymentByReference(referenceNumber: string): Promise<RemotePayment | null> {
    await this.maybeFail('any');
    return this.byDoc<RemotePayment>('PAYMENT', referenceNumber);
  }

  async createPayment(input: CreatePaymentInput): Promise<RemotePayment> {
    await this.maybeFail('any');
    assertReferenceLength(input.referenceNumber);
    const record: RemotePayment = {
      id: await this.nextId('PAYMENT'),
      referenceNumber: input.referenceNumber,
      customerId: input.customerId,
      totalCents: input.amountCents,
      linkedInvoiceIds: input.linkedInvoiceId ? [input.linkedInvoiceId] : [],
      syncToken: '0',
      txnDate: input.txnDate,
    };
    if (input.linkedInvoiceId) {
      const inv = await this.db.simulatorRecord.findUnique({
        where: {
          provider_entityType_externalId: { provider: 'QBO', entityType: 'INVOICE', externalId: input.linkedInvoiceId },
        },
      });
      if (inv) {
        const data = inv.data as unknown as RemoteInvoice;
        await this.put(
          'INVOICE',
          { ...data, balanceCents: Math.max(0, data.balanceCents - input.amountCents) },
          data.docNumber,
        );
      }
    }
    return this.put('PAYMENT', record, input.referenceNumber);
  }

  async findCreditByDocNumber(docNumber: string): Promise<RemoteCredit | null> {
    await this.maybeFail('any');
    return this.byDoc<RemoteCredit>('CREDIT', docNumber);
  }

  async createCredit(input: CreateCreditInput): Promise<RemoteCredit> {
    await this.maybeFail('any');
    return this.put(
      'CREDIT',
      {
        id: await this.nextId('CREDIT'),
        docNumber: input.docNumber,
        customerId: input.customerId,
        totalCents: input.amountCents,
        syncToken: '0',
      },
      input.docNumber,
    );
  }

  async listInvoices(docNumbers: string[]): Promise<RemoteInvoice[]> {
    await this.maybeFail('any');
    const rows = await this.db.simulatorRecord.findMany({
      where: { provider: 'QBO', entityType: 'INVOICE', docNumber: { in: docNumbers } },
    });
    return rows.map((r) => r.data as unknown as RemoteInvoice);
  }

  async listPayments(referenceNumbers: string[]): Promise<RemotePayment[]> {
    await this.maybeFail('any');
    const rows = await this.db.simulatorRecord.findMany({
      where: { provider: 'QBO', entityType: 'PAYMENT', docNumber: { in: referenceNumbers } },
    });
    return rows.map((r) => r.data as unknown as RemotePayment);
  }

  /** Demo control: change what the books say so reconciliation has something to find. */
  async tamper(
    entityType: 'INVOICE' | 'PAYMENT',
    docNumber: string,
    patch: { totalCents?: number; unlink?: boolean },
  ): Promise<boolean> {
    const row = await this.db.simulatorRecord.findFirst({ where: { provider: 'QBO', entityType, docNumber } });
    if (!row) return false;
    const data = row.data as unknown as RemoteInvoice & RemotePayment;
    const next = { ...data };
    if (patch.totalCents !== undefined) next.totalCents = patch.totalCents;
    if (patch.unlink) next.linkedInvoiceIds = [];
    next.syncToken = String(Number(data.syncToken) + 1);
    await this.db.simulatorRecord.update({ where: { id: row.id }, data: { data: next as never } });
    return true;
  }
}

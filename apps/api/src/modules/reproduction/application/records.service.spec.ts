/**
 * Row-level access: a customer sees their own records and nothing else, at every entry point
 * the assistant's tools also use.
 */
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../../test-support/module';
import { ReproductionModule } from '../reproduction.module';
import { RecordsService } from './records.service';

describe('RecordsService RBAC (integration)', () => {
  const modules: TestingModule[] = [];
  let records: RecordsService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await tracked(createTestModule({ imports: [ReproductionModule] }));
    records = moduleRef.get(RecordsService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function tracked(pending: Promise<TestingModule>): Promise<TestingModule> {
    const m = await pending;
    modules.push(m);
    return m;
  }

  it("a customer cannot open another customer's embryo, contract, or customer page", async () => {
    const customerUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'CUSTOMER' } });
    const actor = { userId: customerUser.id, role: 'CUSTOMER' as const, customerId: customerUser.customerId };
    const foreignEmbryo = await prisma.client.embryo.findFirstOrThrow({
      where: { customerId: { not: actor.customerId ?? '' } },
    });
    const foreignContract = await prisma.client.contract.findFirstOrThrow({
      where: { customerId: { not: actor.customerId ?? '' } },
    });

    await expect(records.getEmbryo(actor, foreignEmbryo.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(records.getContract(actor, foreignContract.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(records.getCustomer(actor, foreignContract.customerId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(records.listCustomers(actor)).rejects.toBeInstanceOf(ForbiddenException);

    const own = await records.listEmbryos(actor);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.customerId === actor.customerId)).toBe(true);

    const hits = await records.search(actor, 'E-26');
    expect(hits.filter((h) => h.type === 'embryo').every((h) => own.some((e) => e.id === h.id))).toBe(true);
  });

  it('a recip-farm user sees embryos but not the money on them', async () => {
    const recipUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'RECIPS' } });
    const actor = { userId: recipUser.id, role: 'RECIPS' as const, customerId: null };
    const withInvoice = await prisma.client.invoice.findFirstOrThrow({ where: { embryoId: { not: null } } });
    const page = await records.getEmbryo(actor, withInvoice.embryoId!);
    expect(page.embryo.invoices).toHaveLength(0);
    expect(page.timeline.some((t) => t.kind === 'invoice' || t.kind === 'payment')).toBe(false);
  });

  it('billing sees the money and the check that created it', async () => {
    const billingUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'BILLING' } });
    const actor = { userId: billingUser.id, role: 'BILLING' as const, customerId: null };
    const withInvoice = await prisma.client.invoice.findFirstOrThrow({
      where: { embryoId: { not: null }, triggeredByCheckId: { not: null } },
    });
    const page = await records.getEmbryo(actor, withInvoice.embryoId!);
    expect(page.embryo.invoices.length).toBeGreaterThan(0);
    const invoiceEvent = page.timeline.find((t) => t.id === withInvoice.id);
    expect(invoiceEvent?.links).toContain(withInvoice.triggeredByCheckId);
  });
});

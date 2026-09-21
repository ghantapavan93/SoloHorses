import type { PrismaClient } from '@daysheet/db';

/**
 * Self-contained fixtures so tests never depend on (or consume) the demo seed.
 * Season 99 marks everything a test creates; the seed never uses it.
 *
 * Ids come from the shared `Sequence` table (the same counter the API uses for real codes),
 * so parallel Jest workers, repeated runs against the same database and a running API can
 * never hand out the same code twice. An in-process counter seeded from the clock did, rarely.
 */
export async function seq(db: PrismaClient, key = 'test-fixture'): Promise<string> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Sequence upsert returned no row');
  return String(value).padStart(4, '0');
}

/**
 * A code the API itself may later mint for the same prefix — a payment on a season-99 invoice
 * comes out of `CodesService` as `PAY-99-nnnn` — must come from that prefix's own counter, or
 * the two counters cross and a fixture's id collides with the API's.
 */
export async function apiCode(db: PrismaClient, prefix: 'PAY-99' | 'INV-99' | 'REF-99'): Promise<string> {
  return `${prefix}-${await seq(db, prefix)}`;
}

export async function createCustomerFixture(db: PrismaClient) {
  const id = `C-9${await seq(db)}`;
  return db.customer.create({
    data: {
      id,
      displayName: `Test Owner ${id}`,
      email: `${id.toLowerCase()}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
    },
  });
}

export async function createContractFixture(
  db: PrismaClient,
  options: { status: 'SIGNED' | 'DEPOSIT_PAID' | 'SHIPPABLE'; withHeldOrder?: boolean },
) {
  const customer = await createCustomerFixture(db);
  const stallionId = `H-9${await seq(db)}`;
  const stallion = await db.horse.create({
    data: { id: stallionId, name: `Test Stallion ${stallionId}`, sex: 'STALLION', kind: 'STALLION', site: 'SOUTH' },
  });
  const mareId = `H-9${await seq(db)}`;
  const mare = await db.horse.create({
    data: { id: mareId, name: `Test Mare ${mareId}`, sex: 'MARE', kind: 'DONOR', site: 'NORTH', ownerId: customer.id },
  });
  const contract = await db.contract.create({
    data: {
      id: `SS-99-${await seq(db)}`,
      season: 2099,
      type: 'FRESH_COOLED',
      status: options.status,
      customerId: customer.id,
      stallionId: stallion.id,
      mareId: mare.id,
      studFeeCents: 450_000,
      chuteFeeCents: 150_000,
      depositCents: 100_000,
      signedAt: options.status === 'SIGNED' || options.status === 'SHIPPABLE' ? new Date() : null,
    },
  });
  const deposit = await db.invoice.create({
    data: {
      id: await apiCode(db, 'INV-99'),
      kind: 'DEPOSIT',
      status: 'PAID',
      customerId: customer.id,
      contractId: contract.id,
      amountCents: 100_000,
      description: 'deposit',
      issuedOn: new Date(),
      dueOn: new Date(),
    },
  });
  const depositPaymentId = `PAY-98-${await seq(db)}`;
  await db.payment.create({
    data: {
      id: depositPaymentId,
      invoiceId: deposit.id,
      customerId: customer.id,
      method: 'CARD',
      status: 'SUCCEEDED',
      amountCents: 100_000,
      receivedAt: new Date(),
      stripePaymentIntentId: `pi_fixture_${depositPaymentId}`,
    },
  });
  const open =
    options.status === 'SHIPPABLE'
      ? []
      : [
          await db.invoice.create({
            data: {
              id: await apiCode(db, 'INV-99'),
              kind: 'STUD_FEE',
              status: 'OPEN',
              customerId: customer.id,
              contractId: contract.id,
              amountCents: 450_000,
              description: 'stud fee',
              issuedOn: new Date(),
              dueOn: new Date(),
            },
          }),
          await db.invoice.create({
            data: {
              id: await apiCode(db, 'INV-99'),
              kind: 'CHUTE_FEE',
              status: 'OPEN',
              customerId: customer.id,
              contractId: contract.id,
              amountCents: 150_000,
              description: 'chute fee',
              issuedOn: new Date(),
              dueOn: new Date(),
            },
          }),
        ];
  const order = options.withHeldOrder
    ? await db.semenOrder.create({
        data: {
          id: `SO-99-${await seq(db)}`,
          contractId: contract.id,
          mareId: mare.id,
          status: 'HOLD_UNPAID',
          requestedFor: new Date(),
          placedAt: new Date(),
          shipToVet: 'Dr. Test',
          shipToCity: 'Testville, TX',
          container: 'Equitainer',
        },
      })
    : null;
  return { customer, stallion, mare, contract, openInvoices: open, order };
}

export async function createTransferFixture(
  db: PrismaClient,
  options: { vetUserId: string; daysAgo: number; icsiContract?: boolean },
) {
  const customer = await createCustomerFixture(db);
  const stallionId = `H-9${await seq(db)}`;
  const stallion = await db.horse.create({
    data: { id: stallionId, name: `Test Stallion ${stallionId}`, sex: 'STALLION', kind: 'STALLION', site: 'SOUTH' },
  });
  const donorId = `H-9${await seq(db)}`;
  const donor = await db.horse.create({
    data: {
      id: donorId,
      name: `Test Donor ${donorId}`,
      sex: 'MARE',
      kind: 'DONOR',
      site: 'NORTH',
      ownerId: customer.id,
    },
  });
  const recipSeq = await seq(db);
  const recip = await db.horse.create({
    data: {
      id: `R-9${recipSeq}`,
      name: 'Test Recip',
      sex: 'MARE',
      kind: 'RECIPIENT',
      site: 'RECIP_FARM',
      recipNumber: 900_000 + Number(recipSeq),
      recipStatus: 'CARRYING',
    },
  });
  const contract = options.icsiContract
    ? await db.contract.create({
        data: {
          id: `SS-99-${await seq(db)}`,
          season: 2099,
          type: 'ICSI',
          status: 'SHIPPABLE',
          customerId: customer.id,
          stallionId: stallion.id,
          mareId: donor.id,
          studFeeCents: 450_000,
          chuteFeeCents: 150_000,
          depositCents: 100_000,
          signedAt: new Date(),
        },
      })
    : null;
  const embryo = await db.embryo.create({
    data: {
      id: `E-99-${await seq(db)}`,
      source: 'ICSI',
      status: 'TRANSFERRED',
      customerId: customer.id,
      contractId: contract?.id ?? null,
      sireId: stallion.id,
      damId: donor.id,
    },
  });
  const performedOn = new Date(Date.now() - options.daysAgo * 86_400_000);
  const transfer = await db.transfer.create({
    data: { id: `TR-99-${await seq(db)}`, embryoId: embryo.id, recipientId: recip.id, performedOn },
  });
  return { customer, embryo, transfer, recip, contract, vetUserId: options.vetUserId };
}

/**
 * The board scene the seed writes, for one fresh payment: a paid invoice, its customer in
 * the books, five rate-limited sync attempts, a dead-lettered `qbo-sync` job and the
 * exception the dead-letter consumer would raise for it. Same ids and keys as the seed, so
 * the retry path is the one a person clicks.
 */
export async function createDeadSyncSceneFixture(db: PrismaClient) {
  const customer = await createCustomerFixture(db);
  const customerExternalId = `cus_fixture_${customer.id.toLowerCase()}`;
  await db.accountingMapping.create({
    data: {
      entityType: 'CUSTOMER',
      entityId: customer.id,
      externalId: customerExternalId,
      status: 'SYNCED',
      syncToken: '0',
      lastSyncedAt: new Date(),
    },
  });
  await db.simulatorRecord.create({
    data: {
      provider: 'QBO',
      entityType: 'CUSTOMER',
      externalId: customerExternalId,
      docNumber: customer.displayName,
      data: { id: customerExternalId, displayName: customer.displayName, syncToken: '0' },
    },
  });
  const invoice = await db.invoice.create({
    data: {
      id: await apiCode(db, 'INV-99'),
      kind: 'BOARD',
      status: 'PAID',
      customerId: customer.id,
      amountCents: 239_800,
      description: 'board',
      issuedOn: new Date(),
      dueOn: new Date(),
    },
  });
  const invoiceExternalId = `inv_fixture_${invoice.id.toLowerCase()}`;
  await db.accountingMapping.create({
    data: {
      entityType: 'INVOICE',
      entityId: invoice.id,
      externalId: invoiceExternalId,
      status: 'SYNCED',
      syncToken: '1',
      lastSyncedAt: new Date(),
      attempts: 1,
    },
  });
  await db.simulatorRecord.create({
    data: {
      provider: 'QBO',
      entityType: 'INVOICE',
      externalId: invoiceExternalId,
      docNumber: invoice.id,
      data: {
        id: invoiceExternalId,
        docNumber: invoice.id,
        customerId: customerExternalId,
        totalCents: invoice.amountCents,
        balanceCents: invoice.amountCents,
        syncToken: '1',
        txnDate: '2099-01-01',
        dueDate: '2099-01-15',
      },
    },
  });
  const paymentId = await apiCode(db, 'PAY-99');
  await db.payment.create({
    data: {
      id: paymentId,
      invoiceId: invoice.id,
      customerId: customer.id,
      method: 'CARD',
      status: 'SUCCEEDED',
      amountCents: invoice.amountCents,
      receivedAt: new Date(),
      stripePaymentIntentId: `pi_fixture_${paymentId}`,
    },
  });
  const error = 'HTTP 429 Too Many Requests: the accounting API is rate limiting this company';
  const jobId = `qbo_PAYMENT_${paymentId}`;
  const mapping = await db.accountingMapping.create({
    data: {
      entityType: 'PAYMENT',
      entityId: paymentId,
      externalId: null,
      status: 'FAILED',
      attempts: 5,
      lastError: error,
    },
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await db.syncAttempt.create({
      data: {
        mappingId: mapping.id,
        startedAt: new Date(Date.now() - (6 - attempt) * 10_000),
        finishedAt: new Date(),
        ok: false,
        httpStatus: 429,
        error,
        jobId,
      },
    });
  }
  const deadAt = new Date();
  await db.jobRecord.create({
    data: {
      id: jobId,
      queue: 'qbo-sync',
      payload: { entityType: 'PAYMENT', entityId: paymentId, reason: 'succeeded' },
      status: 'DEAD',
      attempts: 5,
      maxAttempts: 5,
      lastError: error,
      createdAt: deadAt,
      enqueuedAt: deadAt,
      finishedAt: deadAt,
      deadLetteredAt: deadAt,
    },
  });
  const exception = await db.operationalException.create({
    data: {
      id: `OX-99-${await seq(db)}`,
      kind: 'ACCOUNTING_SYNC_FAILED',
      severity: 'WARN',
      source: 'QBO',
      title: `QuickBooks payment sync for ${paymentId} failed after 5 attempts: ${error}`,
      detail: {
        jobId,
        queue: 'qbo-sync',
        attempts: 5,
        error,
        payload: { entityType: 'PAYMENT', entityId: paymentId, reason: 'succeeded' },
      },
      entityType: 'Payment',
      entityId: paymentId,
      dedupeKey: `job:${jobId}`,
      openKey: `job:${jobId}`,
    },
  });
  return { customer, invoice, paymentId, jobId, exception };
}

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from './index';

loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

/**
 * The database, not the application, guarantees the audit trail cannot be rewritten.
 * Needs DATABASE_URL with the migrations applied.
 */
describe('append-only guards', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createPrismaClient({ connectionString: process.env.DATABASE_URL ?? '' });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects UPDATE and DELETE on AuditEvent', async () => {
    const row = await db.auditEvent.create({
      data: { action: 'test.guard', entityType: 'Test', entityId: 'guard', source: 'SEED' },
    });
    await expect(db.auditEvent.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    const still = await db.auditEvent.findUnique({ where: { id: row.id } });
    expect(still?.action).toBe('test.guard');
  });

  it('keeps IntegrationEvent identity and payload write-once but allows status updates', async () => {
    const externalId = `evt_guard_${Date.now()}`;
    const row = await db.integrationEvent.create({
      data: { provider: 'STRIPE', externalId, type: 'test', payload: { a: 1 } },
    });
    await expect(db.integrationEvent.update({ where: { id: row.id }, data: { payload: { a: 2 } } })).rejects.toThrow(
      /write-once/,
    );
    await expect(
      db.integrationEvent.update({ where: { id: row.id }, data: { externalId: `${externalId}_x` } }),
    ).rejects.toThrow(/write-once/);
    const updated = await db.integrationEvent.update({
      where: { id: row.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    expect(updated.status).toBe('PROCESSED');
    await expect(db.integrationEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('enforces uniqueness of (provider, externalId)', async () => {
    const externalId = `evt_unique_${Date.now()}`;
    await db.integrationEvent.create({ data: { provider: 'STRIPE', externalId, type: 'test', payload: {} } });
    await expect(
      db.integrationEvent.create({ data: { provider: 'STRIPE', externalId, type: 'test', payload: {} } }),
    ).rejects.toThrow();
  });
});

import { Injectable } from '@nestjs/common';
import { formatEntityId, type IdKind } from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Hands out the next human-readable code for a kind and season, atomically.
 * One UPDATE … RETURNING per code; safe under concurrent workers, and never derived from
 * a row count (which drifts as soon as anything is deleted or seeded).
 */
@Injectable()
export class CodesService {
  constructor(private readonly prisma: PrismaService) {}

  async next(kind: IdKind, season: number, tx?: Prisma.TransactionClient): Promise<string> {
    const permanent = kind === 'customer' || kind === 'horse' || kind === 'recip';
    const sample = formatEntityId(kind, 1, permanent ? undefined : season);
    const key = sample
      .split('-')
      .slice(0, permanent ? 1 : 2)
      .join('-');
    const client = tx ?? this.prisma.client;
    const rows = await client.$queryRaw<{ value: number }[]>`
      INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
      RETURNING "value"`;
    const value = rows[0]?.value;
    if (value === undefined) throw new Error(`sequence ${key} did not return a value`);
    return formatEntityId(kind, value, permanent ? undefined : season);
  }
}

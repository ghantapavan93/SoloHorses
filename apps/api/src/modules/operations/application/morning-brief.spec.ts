/**
 * The front door's five seconds, read from the seeded board: every number comes from the same
 * rows the ring and the board show, the dollars count each obligation once, the three cards are
 * the reader's own first, and the same world gives the same state id.
 */
import { sumStakes, type Actor } from '@daysheet/domain';
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { BillingModule } from '../../billing/billing.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { VeterinaryModule } from '../../veterinary/veterinary.module';
import { OperationsModule } from '../operations.module';
import { BriefService } from './brief.service';
import { ExceptionsService } from './exceptions.service';

const admin: Actor = { userId: 'test-admin', role: 'ADMIN', customerId: null };
const vet: Actor = { userId: 'test-vet', role: 'VET', customerId: null };

describe('the morning brief', () => {
  let moduleRef: TestingModule;
  let briefs: BriefService;
  let exceptions: ExceptionsService;

  beforeAll(async () => {
    moduleRef = await createTestModule({
      imports: [AccountingModule, BillingModule, ReproductionModule, VeterinaryModule, OperationsModule],
    });
    briefs = moduleRef.get(BriefService);
    exceptions = moduleRef.get(ExceptionsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('counts the board as the board counts itself, and the dollars each obligation once', async () => {
    const summary = await exceptions.summary();
    const [brief, signals] = await Promise.all([
      briefs.morning(admin),
      exceptions.signals(Math.max(200, summary.open)),
    ]);
    expect(brief.decisions).toBe(summary.open);
    expect(brief.needsYou).toBe(summary.open); // the founder owns every decision
    expect(brief.atStakeCents).toBe(sumStakes(signals.flatMap((s) => (s.stake ? [s.stake] : []))));
    expect(Object.values(brief.byOwner).reduce((a, b) => a + b, 0)).toBe(summary.open);
    expect(Object.values(brief.byChannel).reduce((a, b) => a + b, 0)).toBe(summary.open);
    expect(brief.top.length).toBeLessThanOrEqual(3);
    for (const card of brief.top) {
      expect(signals.map((s) => s.id)).toContain(card.id);
      expect(card.reason.length).toBeGreaterThan(0);
      expect(['now', 'today', 'watch']).toContain(card.urgency);
      expect(card.next.length).toBeGreaterThan(0);
      expect(card.evidence).toBeGreaterThan(0);
    }
  });

  it('puts the reader’s own rows first, and gives the same world the same state id', async () => {
    const [first, again] = await Promise.all([briefs.morning(vet), briefs.morning(vet)]);
    expect(first.stateId).toBe(again.stateId);
    expect(first.needsYou).toBe(first.byOwner['VET'] ?? 0);
    const own = first.top.filter((c) => c.owner === 'VET').length;
    // The vet's cards are hers while she has any; only then the rest of the board.
    expect(own).toBe(Math.min(3, first.needsYou));
  });
});

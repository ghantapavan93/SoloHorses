import { Injectable } from '@nestjs/common';
import { barnDate, type BarnDate } from '@daysheet/domain';
import { EnvService } from '../config/env.module';

/**
 * "Today" at the barn. DEMO_CLOCK freezes the calendar date so the synthetic world stays
 * coherent on any real date; the wall-clock time of day is always real.
 */
@Injectable()
export class ClockService {
  private readonly frozenDate: BarnDate | null;

  constructor(envService: EnvService) {
    const demo = envService.env.DEMO_CLOCK;
    this.frozenDate = demo.length > 0 ? demo : null;
  }

  now(): Date {
    return new Date();
  }

  today(): BarnDate {
    return this.frozenDate ?? barnDate(this.now());
  }

  isFrozen(): boolean {
    return this.frozenDate !== null;
  }
}

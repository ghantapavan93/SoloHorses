import { Module } from '@nestjs/common';
import { ChecksController } from './api/checks.controller';
import { ClearancesController } from './api/clearances.controller';
import { ChecksService } from './application/checks.service';
import { ClearancesService } from './application/clearances.service';

/** Veterinary: what the scan showed and what the vet cleared, recorded by the vet; the rules decide what it means. */
@Module({
  controllers: [ChecksController, ClearancesController],
  providers: [ChecksService, ClearancesService],
  exports: [ChecksService, ClearancesService],
})
export class VeterinaryModule {}

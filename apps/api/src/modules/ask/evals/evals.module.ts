import { Module } from '@nestjs/common';
import { AskModule } from '../ask.module';
import { EvalsController } from './evals.controller';
import { EvalsService } from './evals.service';

@Module({ imports: [AskModule], controllers: [EvalsController], providers: [EvalsService], exports: [EvalsService] })
export class EvalsModule {}

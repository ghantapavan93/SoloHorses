import { Global, Module } from '@nestjs/common';
import { CodesService } from './codes.service';

@Global()
@Module({ providers: [CodesService], exports: [CodesService] })
export class CodesModule {}

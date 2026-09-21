import { Controller, Get, Query } from '@nestjs/common';
import { Requires } from '../security/permission.guard';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Requires('read', 'audit')
  async list(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.audit.forEntity(entityType, entityId);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogQueryDto } from '../common/dto.js';
import { AuditService } from './audit.service.js';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Read-only audit history. There is intentionally no create, update or
   * delete route: the trail is append-only from the application's perspective.
   */
  @Get()
  async list(@Query() query: AuditLogQueryDto) {
    return this.audit.list(query);
  }
}

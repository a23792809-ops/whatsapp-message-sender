import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateSettingsDto } from '../common/dto.js';
import { SettingsService } from './settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Resolved settings: stored values, falling back to environment defaults. */
  @Get()
  async get() {
    return this.settings.get();
  }

  /**
   * Partial update; omitted keys keep their current value. Only the names of
   * the changed keys are audited, never their values.
   */
  @Put()
  async update(@Body() body: UpdateSettingsDto) {
    const keys = Object.keys(body ?? {}).filter((k) => (body as any)[k] !== undefined);
    return this.audit.auditAction(
      {
        action: AuditAction.SETTINGS_UPDATE,
        entityType: AuditEntityType.SETTINGS,
        message: keys.length ? `updated ${keys.sort().join(', ')}` : 'no changes',
      },
      () => this.settings.update(body),
    );
  }
}

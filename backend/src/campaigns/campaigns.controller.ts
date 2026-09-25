import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateCampaignDto } from '../common/dto.js';
import { CampaignsService } from './campaigns.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@Body() body: CreateCampaignDto) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_CREATE, entityType: AuditEntityType.CAMPAIGN, message: `campaign "${body.name}"` },
      () => this.campaigns.create(body),
    );
  }

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.campaigns.getById(id);
  }

  @Get(':id/progress')
  progress(@Param('id') id: string) {
    return this.campaigns.progress(id);
  }

  @Post(':id/start')
  async start(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_START, entityType: AuditEntityType.CAMPAIGN, entityId: id },
      () => this.campaigns.start(id),
    );
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_PAUSE, entityType: AuditEntityType.CAMPAIGN, entityId: id },
      () => this.campaigns.pause(id),
    );
  }

  @Post(':id/resume')
  async resume(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_RESUME, entityType: AuditEntityType.CAMPAIGN, entityId: id },
      () => this.campaigns.resume(id),
    );
  }

  @Post(':id/stop')
  async stop(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_STOP, entityType: AuditEntityType.CAMPAIGN, entityId: id },
      () => this.campaigns.stop(id),
    );
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.CAMPAIGN_RETRY, entityType: AuditEntityType.CAMPAIGN, entityId: id },
      () => this.campaigns.retryFailed(id),
    );
  }
}

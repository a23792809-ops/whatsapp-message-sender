import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateTemplateDto, PreviewTemplateDto, UpdateTemplateDto } from '../common/dto.js';
import { TemplatesService } from './templates.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@Body() body: CreateTemplateDto) {
    return this.audit.auditAction(
      { action: AuditAction.TEMPLATE_CREATE, entityType: AuditEntityType.TEMPLATE, message: `template "${body.name}"` },
      () => this.templates.create(body),
    );
  }

  @Get()
  async list() {
    return this.templates.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.templates.getById(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.audit.auditAction(
      { action: AuditAction.TEMPLATE_UPDATE, entityType: AuditEntityType.TEMPLATE, entityId: id },
      () => this.templates.update(id, body),
    );
  }

  @Delete(':id')
  async archive(@Param('id') id: string) {
    return this.audit.auditAction(
      { action: AuditAction.TEMPLATE_ARCHIVE, entityType: AuditEntityType.TEMPLATE, entityId: id },
      () => this.templates.archive(id),
    );
  }

  @Post(':id/preview')
  async preview(@Param('id') id: string, @Body() body: PreviewTemplateDto) {
    return this.templates.preview(id, body.customerId);
  }
}

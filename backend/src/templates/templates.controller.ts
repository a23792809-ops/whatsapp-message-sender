import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateTemplateDto, PreviewTemplateDto, UpdateTemplateDto } from '../common/dto.js';
import { TemplatesService } from './templates.service.js';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post()
  async create(@Body() body: CreateTemplateDto) {
    return this.templates.create(body);
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
    return this.templates.update(id, body);
  }

  @Delete(':id')
  async archive(@Param('id') id: string) {
    return this.templates.archive(id);
  }

  @Post(':id/preview')
  async preview(@Param('id') id: string, @Body() body: PreviewTemplateDto) {
    return this.templates.preview(id, body.customerId);
  }
}

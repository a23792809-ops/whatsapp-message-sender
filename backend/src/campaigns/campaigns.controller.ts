import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateCampaignDto } from '../common/dto.js';
import { CampaignsService } from './campaigns.service.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  create(@Body() body: CreateCampaignDto) {
    return this.campaigns.create(body);
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
  start(@Param('id') id: string) {
    return this.campaigns.start(id);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.campaigns.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.campaigns.resume(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.campaigns.stop(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.campaigns.retryFailed(id);
  }
}

import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Aggregated dashboard figures, computed by the database. */
  @Get('dashboard')
  async dashboard() {
    return this.analytics.dashboard();
  }
}

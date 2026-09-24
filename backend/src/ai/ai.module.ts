import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';

@Module({
  controllers: [AiController],
  providers: [AiService, ProviderRegistry],
  exports: [AiService],
})
export class AiModule {}
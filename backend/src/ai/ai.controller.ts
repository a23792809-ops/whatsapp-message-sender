import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { GenerateAiDto } from './dto/generate-ai.dto.js';
import { ImproveAiDto } from './dto/improve-ai.dto.js';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('generate')
  generate(@Body() body: GenerateAiDto) {
    return this.ai.generate(body);
  }

  @Post('improve')
  improve(@Body() body: ImproveAiDto) {
    return this.ai.improve(body);
  }
}
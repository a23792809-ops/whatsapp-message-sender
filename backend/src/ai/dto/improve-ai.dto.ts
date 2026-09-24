import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AI_LIMITS, SUPPORTED_PROVIDERS } from '../ai.types.js';

export class ImproveAiDto {
  @IsOptional()
  @IsIn(SUPPORTED_PROVIDERS)
  provider?: 'openai' | 'deepseek';

  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_LIMITS.maxMessageLength)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxInstructionsLength)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxToneLength)
  tone?: string;
}
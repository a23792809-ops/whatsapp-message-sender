import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AI_LIMITS, SUPPORTED_PROVIDERS } from '../ai.types.js';

export class GenerateAiDto {
  @IsOptional()
  @IsIn(SUPPORTED_PROVIDERS)
  provider?: 'openai' | 'deepseek';

  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_LIMITS.maxTemplateLength)
  template!: string;

  @IsObject()
  customer!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxInstructionsLength)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxToneLength)
  tone?: string;
}
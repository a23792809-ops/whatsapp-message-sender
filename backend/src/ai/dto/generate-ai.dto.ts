import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AI_LIMITS, LANGUAGE_PATTERN, SUPPORTED_PROVIDERS } from '../ai.types.js';

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

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxLanguageLength)
  @Matches(LANGUAGE_PATTERN, { message: 'language must be a language tag such as "en" or "hi-IN"' })
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_LIMITS.maxBusinessContextLength)
  businessContext?: string;
}
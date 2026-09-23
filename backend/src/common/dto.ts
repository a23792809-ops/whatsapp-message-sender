import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ISO_LANGUAGE_PATTERN = /^[a-z]{2,3}([-_][A-Z]{2,3})?$/;

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  metaName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'metaLanguage must be an ISO language code (e.g. en, hi)' })
  metaLanguage?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  metaName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'metaLanguage must be an ISO language code (e.g. en, hi)' })
  metaLanguage?: string;
}

export class PreviewTemplateDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  customerIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600_000)
  throttleMs?: number;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;
}

export class TestSendDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s()-]{9,18}$/, { message: 'to must be a valid phone number' })
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  templateName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'language must be an ISO language code (e.g. en, hi)' })
  language?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  parameters?: string[];
}
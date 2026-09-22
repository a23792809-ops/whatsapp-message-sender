import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  to!: string;

  @IsOptional()
  @IsString()
  message?: string;
}
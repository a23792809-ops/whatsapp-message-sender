import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  @Matches(/^[\w.-]+$/)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 512)
  password!: string;
}
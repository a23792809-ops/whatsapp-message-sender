import { IsNotEmpty, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 512)
  password!: string;
}
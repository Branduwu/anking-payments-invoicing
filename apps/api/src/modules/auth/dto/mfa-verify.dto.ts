import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Length(6, 12)
  code!: string;

  @IsOptional()
  @IsIn(['totp', 'recovery_code'])
  method?: 'totp' | 'recovery_code';
}

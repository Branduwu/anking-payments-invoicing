import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Length(6, 32)
  code!: string;

  @IsOptional()
  @IsIn(['totp', 'recovery_code'])
  method?: 'totp' | 'recovery_code';

  @IsOptional()
  @IsIn(['login', 'reauth'])
  purpose?: 'login' | 'reauth';
}

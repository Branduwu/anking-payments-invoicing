import { IsString, MaxLength } from 'class-validator';

export class MfaAdminResetDto {
  @IsString()
  @MaxLength(64)
  userId!: string;

  @IsString()
  @MaxLength(256)
  reason!: string;
}

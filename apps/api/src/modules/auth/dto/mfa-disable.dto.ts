import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MfaDisableDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

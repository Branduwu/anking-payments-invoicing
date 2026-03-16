import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreatePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsString()
  @MaxLength(64)
  bankAccountRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  concept?: string;
}


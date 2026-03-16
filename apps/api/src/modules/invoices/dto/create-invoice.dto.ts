import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  @MaxLength(32)
  customerTaxId!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  subtotal!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  total!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;
}


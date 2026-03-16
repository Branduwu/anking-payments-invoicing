import { IsString, MaxLength } from 'class-validator';

export class CancelInvoiceDto {
  @IsString()
  @MaxLength(64)
  invoiceId!: string;

  @IsString()
  @MaxLength(256)
  reason!: string;
}


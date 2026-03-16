import { IsString, MaxLength } from 'class-validator';

export class StampInvoiceDto {
  @IsString()
  @MaxLength(64)
  invoiceId!: string;
}

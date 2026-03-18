import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ReconcileInvoiceProcessingDto {
  @IsString()
  @MaxLength(64)
  invoiceId!: string;

  @IsOptional()
  @IsIn(['CONFIRMED', 'FAILED'])
  resolution?: 'CONFIRMED' | 'FAILED';

  @ValidateIf((value: ReconcileInvoiceProcessingDto) => value.resolution === 'CONFIRMED')
  @IsOptional()
  @IsString()
  @MaxLength(128)
  pacReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cancellationRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  detail?: string;
}

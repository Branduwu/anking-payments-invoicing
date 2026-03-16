import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PacService } from './pac.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, PacService],
})
export class InvoicesModule {}

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { RequireRecentReauth } from '../../common/decorators/require-recent-reauth.decorator';
import { RecentReauthGuard } from '../../common/guards/recent-reauth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { getRequestMetadata } from '../../common/http/request-metadata';
import type { ActiveSession } from '../sessions/session.types';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { StampInvoiceDto } from './dto/stamp-invoice.dto';
import type { InvoiceView } from './invoice.types';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
@UseGuards(SessionAuthGuard, RecentReauthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequireRecentReauth()
  async create(
    @Body() payload: CreateInvoiceDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    return this.invoicesService.createInvoice(payload, session, getRequestMetadata(request));
  }

  @Get()
  async list(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ items: InvoiceView[]; scope: 'own' | 'all' }> {
    return this.invoicesService.listInvoices(session, getRequestMetadata(request));
  }

  @Post('stamp')
  @RequireRecentReauth()
  async stamp(
    @Body() payload: StampInvoiceDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    return this.invoicesService.stampInvoice(payload, session, getRequestMetadata(request));
  }

  @Post('cancel')
  @RequireRecentReauth()
  async cancel(
    @Body() payload: CancelInvoiceDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    return this.invoicesService.cancelInvoice(payload, session, getRequestMetadata(request));
  }
}

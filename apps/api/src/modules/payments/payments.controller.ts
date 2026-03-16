import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { RequireRecentReauth } from '../../common/decorators/require-recent-reauth.decorator';
import { RecentReauthGuard } from '../../common/guards/recent-reauth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { getRequestMetadata } from '../../common/http/request-metadata';
import type { ActiveSession } from '../sessions/session.types';
import { CreatePaymentDto } from './dto/create-payment.dto';
import type { PaymentView } from './payment.types';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(SessionAuthGuard, RecentReauthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequireRecentReauth()
  async create(
    @Body() payload: CreatePaymentDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ payment: PaymentView; message: string }> {
    return this.paymentsService.createPayment(payload, session, getRequestMetadata(request));
  }

  @Get()
  async list(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ items: PaymentView[]; scope: 'own' | 'all' }> {
    return this.paymentsService.listPayments(session, getRequestMetadata(request));
  }
}

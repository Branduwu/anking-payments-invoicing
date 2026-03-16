import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { RequireRecentReauth } from '../../common/decorators/require-recent-reauth.decorator';
import { RecentReauthGuard } from '../../common/guards/recent-reauth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { getRequestMetadata } from '../../common/http/request-metadata';
import type { ActiveSession } from '../sessions/session.types';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import type {
  CustomerScope,
  CustomerSource,
  CustomerView,
} from './customer.types';
import { CustomersService } from './customers.service';

@Controller('customers')
@UseGuards(SessionAuthGuard, RecentReauthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @RequireRecentReauth()
  async create(
    @Body() payload: CreateCustomerDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ customer: CustomerView; message: string }> {
    return this.customersService.createCustomer(payload, session, getRequestMetadata(request));
  }

  @Get()
  async list(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ items: CustomerView[]; scope: CustomerScope; source: CustomerSource }> {
    return this.customersService.listCustomers(session, getRequestMetadata(request));
  }

  @Get(':id')
  async getById(
    @Param('id') customerId: string,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ customer: CustomerView; source: CustomerSource }> {
    return this.customersService.getCustomerById(customerId, session, getRequestMetadata(request));
  }

  @Patch(':id')
  @RequireRecentReauth()
  async update(
    @Param('id') customerId: string,
    @Body() payload: UpdateCustomerDto,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ customer: CustomerView; message: string }> {
    return this.customersService.updateCustomer(
      customerId,
      payload,
      session,
      getRequestMetadata(request),
    );
  }

  @Delete(':id')
  @RequireRecentReauth()
  async remove(
    @Param('id') customerId: string,
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    return this.customersService.deleteCustomer(customerId, session, getRequestMetadata(request));
  }
}

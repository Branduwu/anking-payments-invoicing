import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import type { RequestMetadata } from '../../common/http/request-metadata';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ActiveSession } from '../sessions/session.types';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { PaymentView } from './payment.types';

@Injectable()
export class PaymentsService {
  private readonly createPaymentRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.OPERATOR,
  ];

  private readonly listAllPaymentsRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.AUDITOR,
    UserRole.FINANCE,
  ];

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createPayment(
    payload: CreatePaymentDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ payment: PaymentView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertCanCreatePayment(roles, session.userId, metadata);

    const payment = await this.prismaService.$transaction(async (tx) => {
      const createdPayment = await tx.payment.create({
        data: {
          userId: session.userId,
          amount: new Prisma.Decimal(payload.amount.toFixed(2)),
          currency: payload.currency,
          bankAccountRef: payload.bankAccountRef,
          externalReference: payload.externalReference,
          concept: payload.concept,
          status: PaymentStatus.PENDING,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'payments.create.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'payment',
          entityId: createdPayment.id,
          metadata: {
            bankAccountRef: payload.bankAccountRef,
            currency: payload.currency,
            amount: payload.amount.toFixed(2),
          },
        }),
      });

      return createdPayment;
    });

    return {
      payment: this.toPaymentView(payment),
      message: 'Payment created',
    };
  }

  async listPayments(
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{
    items: PaymentView[];
    scope: 'own' | 'all';
  }> {
    const roles = await this.getUserRoles(session.userId);
    const canListAll = roles.some((role) => this.listAllPaymentsRoles.includes(role));
    const canListOwn = canListAll || roles.includes(UserRole.OPERATOR);

    if (!canListOwn) {
      await this.auditService.record({
        action: 'payments.list.denied',
        result: 'DENIED',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'payment',
        metadata: {
          reason: 'insufficient-role',
          roles,
        },
      });
      throw new ForbiddenException('Insufficient permissions to list payments');
    }

    const payments = await this.prismaService.payment.findMany({
      where: canListAll ? undefined : { userId: session.userId },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: payments.map((payment) => this.toPaymentView(payment)),
      scope: canListAll ? 'all' : 'own',
    };
  }

  private async getUserRoles(userId: string): Promise<UserRole[]> {
    const roles = await this.prismaService.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });

    return roles.map((entry) => entry.role);
  }

  private async assertCanCreatePayment(
    roles: UserRole[],
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const allowed = roles.some((role) => this.createPaymentRoles.includes(role));

    if (allowed) {
      return;
    }

    await this.auditService.record({
      action: 'payments.create.denied',
      result: 'DENIED',
      userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'payment',
      metadata: {
        reason: 'insufficient-role',
        roles,
      },
    });

    throw new ForbiddenException('Insufficient permissions to create payments');
  }

  private toPaymentView(payment: {
    id: string;
    userId: string;
    amount: Prisma.Decimal;
    currency: string;
    status: PaymentStatus;
    bankAccountRef: string;
    externalReference: string | null;
    concept: string | null;
    createdAt: Date;
    updatedAt: Date;
    settledAt: Date | null;
  }): PaymentView {
    return {
      id: payment.id,
      userId: payment.userId,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: payment.status,
      bankAccountRef: payment.bankAccountRef,
      externalReference: payment.externalReference,
      concept: payment.concept,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      settledAt: payment.settledAt,
    };
  }
}

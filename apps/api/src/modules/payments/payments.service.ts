import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole, type Payment } from '@prisma/client';
import { createHash } from 'node:crypto';
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
    const idempotencyKey = payload.idempotencyKey?.trim() || null;
    const idempotencyFingerprint = this.computeIdempotencyFingerprint(payload);

    if (idempotencyKey) {
      const replay = await this.findPaymentReplay(session.userId, idempotencyKey);
      if (replay) {
        return this.resolveIdempotentReplay(
          replay,
          idempotencyKey,
          idempotencyFingerprint,
          session.userId,
          metadata,
        );
      }
    }

    try {
      const payment = await this.prismaService.$transaction(async (tx) => {
        const createdPayment = await tx.payment.create({
          data: {
            userId: session.userId,
            amount: new Prisma.Decimal(payload.amount.toFixed(2)),
            currency: payload.currency,
            bankAccountRef: payload.bankAccountRef,
            externalReference: payload.externalReference,
            idempotencyKey,
            idempotencyFingerprint,
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
              idempotencyKey,
            },
          }),
        });

        return createdPayment;
      });

      return {
        payment: this.toPaymentView(payment),
        message: 'Payment created',
      };
    } catch (error) {
      if (idempotencyKey && this.isPaymentIdempotencyConstraintError(error)) {
        const replay = await this.findPaymentReplay(session.userId, idempotencyKey);
        if (replay) {
          return this.resolveIdempotentReplay(
            replay,
            idempotencyKey,
            idempotencyFingerprint,
            session.userId,
            metadata,
          );
        }
      }

      throw error;
    }
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

  private async findPaymentReplay(userId: string, idempotencyKey: string) {
    return this.prismaService.payment.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
    });
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

  private async resolveIdempotentReplay(
    payment: Payment,
    idempotencyKey: string,
    expectedFingerprint: string,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<{ payment: PaymentView; message: string }> {
    if (payment.idempotencyFingerprint !== expectedFingerprint) {
      await this.auditService.record({
        action: 'payments.create.idempotency_conflict',
        result: 'FAILURE',
        userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'payment',
        entityId: payment.id,
        metadata: {
          idempotencyKey,
          existingFingerprint: payment.idempotencyFingerprint,
          requestFingerprint: expectedFingerprint,
        },
      });

      throw new ConflictException(
        'Idempotency key already exists for a different payment payload',
      );
    }

    await this.auditService.record({
      action: 'payments.create.replayed',
      result: 'SUCCESS',
      userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        idempotencyKey,
      },
    });

    return {
      payment: this.toPaymentView(payment),
      message: 'Payment replay accepted from idempotency key',
    };
  }

  private computeIdempotencyFingerprint(payload: CreatePaymentDto): string {
    const canonicalPayload = {
      amount: payload.amount.toFixed(2),
      currency: payload.currency,
      bankAccountRef: payload.bankAccountRef,
      externalReference: payload.externalReference ?? null,
      concept: payload.concept ?? null,
    };

    return createHash('sha256')
      .update(JSON.stringify(canonicalPayload))
      .digest('hex');
  }

  private isPaymentIdempotencyConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toPaymentView(payment: {
    id: string;
    userId: string;
    amount: Prisma.Decimal;
    currency: string;
    status: PaymentStatus;
    bankAccountRef: string;
    externalReference: string | null;
    idempotencyKey: string | null;
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
      idempotencyKey: payment.idempotencyKey,
      concept: payment.concept,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      settledAt: payment.settledAt,
    };
  }
}

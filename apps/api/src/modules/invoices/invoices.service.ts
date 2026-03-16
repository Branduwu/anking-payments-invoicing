import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { RequestMetadata } from '../../common/http/request-metadata';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ActiveSession } from '../sessions/session.types';
import type { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { StampInvoiceDto } from './dto/stamp-invoice.dto';
import type { InvoiceView } from './invoice.types';
import { PacService } from './pac.service';

@Injectable()
export class InvoicesService {
  private readonly createInvoiceRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.OPERATOR,
  ];

  private readonly listAllInvoiceRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.AUDITOR,
    UserRole.FINANCE,
  ];

  private readonly cancelInvoiceRoles: UserRole[] = [UserRole.ADMIN, UserRole.FINANCE];
  private readonly stampInvoiceRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.OPERATOR,
  ];
  private readonly crossUserInvoiceRoles: UserRole[] = [UserRole.ADMIN, UserRole.FINANCE];

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
    private readonly pacService: PacService,
  ) {}

  async createInvoice(
    payload: CreateInvoiceDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertRoleAllowed(
      roles,
      this.createInvoiceRoles,
      'invoices.create.denied',
      session.userId,
      metadata,
    );
    this.assertInvoiceAmounts(payload.subtotal, payload.total);
    await this.validateLinkedPayment(payload.paymentId, payload.currency, session.userId);

    const folio = await this.generateUniqueFolio();
    const invoice = await this.prismaService.$transaction(async (tx) => {
      const createdInvoice = await tx.invoice.create({
        data: {
          userId: session.userId,
          folio,
          status: InvoiceStatus.DRAFT,
          customerTaxId: payload.customerTaxId,
          currency: payload.currency,
          subtotal: new Prisma.Decimal(payload.subtotal.toFixed(2)),
          total: new Prisma.Decimal(payload.total.toFixed(2)),
          paymentId: payload.paymentId,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'invoices.create.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: createdInvoice.id,
          metadata: {
            folio,
            customerTaxId: payload.customerTaxId,
            currency: payload.currency,
            total: payload.total.toFixed(2),
          },
        }),
      });

      return createdInvoice;
    });

    return {
      invoice: this.toInvoiceView(invoice),
      message: 'Invoice created in DRAFT status',
    };
  }

  async listInvoices(
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ items: InvoiceView[]; scope: 'own' | 'all' }> {
    const roles = await this.getUserRoles(session.userId);
    const canListAll = roles.some((role) => this.listAllInvoiceRoles.includes(role));
    const canListOwn = canListAll || roles.includes(UserRole.OPERATOR);

    if (!canListOwn) {
      await this.auditService.record({
        action: 'invoices.list.denied',
        result: 'DENIED',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'invoice',
        metadata: {
          reason: 'insufficient-role',
          roles,
        },
      });
      throw new ForbiddenException('Insufficient permissions to list invoices');
    }

    const invoices = await this.prismaService.invoice.findMany({
      where: canListAll ? undefined : { userId: session.userId },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: invoices.map((invoice) => this.toInvoiceView(invoice)),
      scope: canListAll ? 'all' : 'own',
    };
  }

  async stampInvoice(
    payload: StampInvoiceDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertRoleAllowed(
      roles,
      this.stampInvoiceRoles,
      'invoices.stamp.denied',
      session.userId,
      metadata,
      payload.invoiceId,
    );

    const invoice = await this.prismaService.invoice.findUnique({
      where: { id: payload.invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    this.assertCanAccessInvoice(roles, session.userId, invoice.userId);

    if (invoice.status === InvoiceStatus.STAMPED) {
      throw new ConflictException('Invoice is already stamped');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('Cancelled invoices cannot be stamped');
    }

    await this.validateLinkedPayment(invoice.paymentId, invoice.currency, invoice.userId);
    const stampResult = await this.pacService.stampInvoice({
      invoiceId: invoice.id,
      folio: invoice.folio,
      customerTaxId: invoice.customerTaxId,
      currency: invoice.currency,
      subtotal: invoice.subtotal.toFixed(2),
      total: invoice.total.toFixed(2),
      paymentId: invoice.paymentId,
      requestId: metadata.requestId,
    });

    const updatedInvoice = await this.prismaService.$transaction(async (tx) => {
      const stampedInvoice = await tx.invoice.update({
        where: { id: payload.invoiceId },
        data: {
          status: InvoiceStatus.STAMPED,
          pacReference: stampResult.pacReference,
          pacProvider: stampResult.provider,
          stampedAt: stampResult.stampedAt,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'invoices.stamp.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: stampedInvoice.id,
          metadata: {
            pacReference: stampResult.pacReference,
            pacProvider: stampResult.provider,
          },
        }),
      });

      return stampedInvoice;
    });

    return {
      invoice: this.toInvoiceView(updatedInvoice),
      message: 'Invoice stamped successfully',
    };
  }

  async cancelInvoice(
    payload: CancelInvoiceDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertRoleAllowed(
      roles,
      this.cancelInvoiceRoles,
      'invoices.cancel.denied',
      session.userId,
      metadata,
      payload.invoiceId,
    );

    const invoice = await this.prismaService.invoice.findUnique({
      where: { id: payload.invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    this.assertCanAccessInvoice(roles, session.userId, invoice.userId);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
    }

    const pacCancellation =
      invoice.status === InvoiceStatus.STAMPED && invoice.pacReference
        ? await this.pacService.cancelInvoice({
            invoiceId: invoice.id,
            folio: invoice.folio,
            pacReference: invoice.pacReference,
            reason: payload.reason,
            requestId: metadata.requestId,
          })
        : null;

    const cancellationRef =
      pacCancellation?.cancellationRef ?? this.generateCancellationReference();
    const cancelledAt = pacCancellation?.cancelledAt ?? new Date();

    const updatedInvoice = await this.prismaService.$transaction(async (tx) => {
      const cancelledInvoice = await tx.invoice.update({
        where: { id: payload.invoiceId },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt,
          cancellationRef,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'invoices.cancel.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: payload.invoiceId,
          metadata: {
            reason: payload.reason,
            cancellationRef,
            pacProvider: pacCancellation?.provider ?? cancelledInvoice.pacProvider,
          },
        }),
      });

      return cancelledInvoice;
    });

    return {
      invoice: this.toInvoiceView(updatedInvoice),
      message:
        invoice.status === InvoiceStatus.STAMPED
          ? 'Stamped invoice cancelled successfully'
          : 'Invoice cancelled',
    };
  }

  private async getUserRoles(userId: string): Promise<UserRole[]> {
    const roles = await this.prismaService.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });

    return roles.map((entry) => entry.role);
  }

  private async assertRoleAllowed(
    currentRoles: UserRole[],
    allowedRoles: UserRole[],
    auditAction: string,
    userId: string,
    metadata: RequestMetadata,
    entityId?: string,
  ): Promise<void> {
    const allowed = currentRoles.some((role) => allowedRoles.includes(role));

    if (allowed) {
      return;
    }

    await this.auditService.record({
      action: auditAction,
      result: 'DENIED',
      userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'invoice',
      entityId,
      metadata: {
        reason: 'insufficient-role',
        roles: currentRoles,
      },
    });

    throw new ForbiddenException('Insufficient permissions to manage invoices');
  }

  private assertCanAccessInvoice(
    currentRoles: UserRole[],
    actingUserId: string,
    invoiceUserId: string,
  ): void {
    if (invoiceUserId === actingUserId) {
      return;
    }

    const canAccessForeignInvoice = currentRoles.some((role) =>
      this.crossUserInvoiceRoles.includes(role),
    );

    if (!canAccessForeignInvoice) {
      throw new ForbiddenException('Insufficient permissions to access this invoice');
    }
  }

  private assertInvoiceAmounts(subtotal: number, total: number): void {
    if (total < subtotal) {
      throw new BadRequestException('Invoice total must be greater than or equal to subtotal');
    }
  }

  private async validateLinkedPayment(
    paymentId: string | null | undefined,
    currency: string,
    expectedUserId: string,
  ): Promise<void> {
    if (!paymentId) {
      return;
    }

    const payment = await this.prismaService.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        currency: true,
        status: true,
      },
    });

    if (!payment || payment.userId !== expectedUserId) {
      throw new NotFoundException('Linked payment not found');
    }

    if (payment.currency !== currency) {
      throw new ConflictException('Invoice currency must match the linked payment currency');
    }

    if (
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.REVERSED
    ) {
      throw new ConflictException('Linked payment is not eligible for invoicing');
    }
  }

  private async generateUniqueFolio(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const folio = this.generateFolioCandidate();
      const exists = await this.prismaService.invoice.findUnique({
        where: { folio },
        select: { id: true },
      });

      if (!exists) {
        return folio;
      }
    }

    throw new ConflictException('Unable to generate a unique invoice folio');
  }

  private generateFolioCandidate(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return `INV-${date}-${suffix}`;
  }

  private generateCancellationReference(): string {
    return `CXL-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private toInvoiceView(invoice: {
    id: string;
    userId: string;
    folio: string;
    status: InvoiceStatus;
    customerTaxId: string;
    currency: string;
    subtotal: Prisma.Decimal;
    total: Prisma.Decimal;
    pacReference: string | null;
    pacProvider: string | null;
    paymentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    stampedAt: Date | null;
    cancelledAt: Date | null;
    cancellationRef: string | null;
  }): InvoiceView {
    return {
      id: invoice.id,
      userId: invoice.userId,
      folio: invoice.folio,
      status: invoice.status,
      customerTaxId: invoice.customerTaxId,
      currency: invoice.currency,
      subtotal: invoice.subtotal.toFixed(2),
      total: invoice.total.toFixed(2),
      pacReference: invoice.pacReference,
      pacProvider: invoice.pacProvider,
      paymentId: invoice.paymentId,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      stampedAt: invoice.stampedAt,
      cancelledAt: invoice.cancelledAt,
      cancellationRef: invoice.cancellationRef,
    };
  }
}

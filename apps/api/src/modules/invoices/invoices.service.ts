import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type Invoice,
  InvoiceProcessingAction,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import type { RequestMetadata } from '../../common/http/request-metadata';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ActiveSession } from '../sessions/session.types';
import type { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { ReconcileInvoiceProcessingDto } from './dto/reconcile-invoice-processing.dto';
import type { StampInvoiceDto } from './dto/stamp-invoice.dto';
import type { InvoiceView } from './invoice.types';
import {
  PacConfirmationRequiredException,
  type PacOperationStatusResult,
  PacService,
} from './pac.service';

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
  private readonly reconcileInvoiceRoles: UserRole[] = [UserRole.ADMIN, UserRole.FINANCE];
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

    await this.assertCanAccessInvoice(
      roles,
      session.userId,
      invoice.userId,
      metadata,
      invoice.id,
    );

    if (invoice.status === InvoiceStatus.STAMPED) {
      throw new ConflictException('Invoice is already stamped');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('Cancelled invoices cannot be stamped');
    }

    const reconciledPendingStamp = await this.reconcilePendingInvoiceIfNeeded(
      invoice,
      InvoiceProcessingAction.STAMP,
      session,
      metadata,
    );
    if (reconciledPendingStamp) {
      return reconciledPendingStamp;
    }

    const operationId = this.generateProcessingOperationId(InvoiceProcessingAction.STAMP);

    await this.acquireInvoiceProcessingLock(
      invoice.id,
      InvoiceProcessingAction.STAMP,
      InvoiceStatus.DRAFT,
      operationId,
    );

    let pacCompleted = false;

    try {
      await this.validateLinkedPayment(invoice.paymentId, invoice.currency, invoice.userId);
      const stampResult = await this.pacService.stampInvoice({
        invoiceId: invoice.id,
        operationId,
        folio: invoice.folio,
        customerTaxId: invoice.customerTaxId,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toFixed(2),
        total: invoice.total.toFixed(2),
        paymentId: invoice.paymentId,
        requestId: metadata.requestId,
      });
      pacCompleted = true;

      const updatedInvoice = await this.prismaService.$transaction(async (tx) => {
        const stampedInvoice = await tx.invoice.update({
          where: { id: payload.invoiceId },
          data: {
            status: InvoiceStatus.STAMPED,
            pacReference: stampResult.pacReference,
            pacProvider: stampResult.provider,
            stampedAt: stampResult.stampedAt,
            processingAction: null,
            processingStartedAt: null,
            processingOperationId: null,
            processingConfirmationRequired: false,
            processingErrorDetail: null,
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
    } catch (error) {
      if (error instanceof PacConfirmationRequiredException) {
        await this.markInvoiceProcessingConfirmationRequired(
          invoice.id,
          InvoiceProcessingAction.STAMP,
          operationId,
          error.message,
        );
        await this.auditService.record({
          action: 'invoices.stamp.confirmation_required',
          result: 'FAILURE',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: {
            operationId,
            provider: error.provider,
          },
        });
      } else if (!pacCompleted) {
        await this.releaseInvoiceProcessingLock(invoice.id, InvoiceProcessingAction.STAMP);
      }
      throw error;
    }
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

    await this.assertCanAccessInvoice(
      roles,
      session.userId,
      invoice.userId,
      metadata,
      invoice.id,
    );

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
    }

    const reconciledPendingCancellation = await this.reconcilePendingInvoiceIfNeeded(
      invoice,
      InvoiceProcessingAction.CANCEL,
      session,
      metadata,
    );
    if (reconciledPendingCancellation) {
      return reconciledPendingCancellation;
    }

    const operationId = this.generateProcessingOperationId(InvoiceProcessingAction.CANCEL);

    await this.acquireInvoiceProcessingLock(
      invoice.id,
      InvoiceProcessingAction.CANCEL,
      {
        in: [InvoiceStatus.DRAFT, InvoiceStatus.STAMPED],
      },
      operationId,
    );

    let pacCompleted = false;

    try {
      const pacCancellation =
        invoice.status === InvoiceStatus.STAMPED && invoice.pacReference
          ? await this.pacService.cancelInvoice({
              invoiceId: invoice.id,
              operationId,
              folio: invoice.folio,
              pacReference: invoice.pacReference,
              reason: payload.reason,
              requestId: metadata.requestId,
            })
          : null;

      pacCompleted = pacCancellation !== null;
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
            processingAction: null,
            processingStartedAt: null,
            processingOperationId: null,
            processingConfirmationRequired: false,
            processingErrorDetail: null,
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
    } catch (error) {
      if (error instanceof PacConfirmationRequiredException) {
        await this.markInvoiceProcessingConfirmationRequired(
          invoice.id,
          InvoiceProcessingAction.CANCEL,
          operationId,
          error.message,
        );
        await this.auditService.record({
          action: 'invoices.cancel.confirmation_required',
          result: 'FAILURE',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: {
            operationId,
            provider: error.provider,
          },
        });
      } else if (!pacCompleted) {
        await this.releaseInvoiceProcessingLock(invoice.id, InvoiceProcessingAction.CANCEL);
      }
      throw error;
    }
  }

  async reconcileInvoiceProcessing(
    payload: ReconcileInvoiceProcessingDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertRoleAllowed(
      roles,
      this.reconcileInvoiceRoles,
      'invoices.reconcile.denied',
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

    if (
      !invoice.processingAction ||
      !invoice.processingOperationId ||
      !invoice.processingConfirmationRequired
    ) {
      throw new ConflictException('Invoice does not have a PAC operation pending confirmation');
    }

    if (payload.resolution === 'FAILED') {
      const clearedInvoice = await this.clearPendingInvoiceOperationState(invoice.id);

      await this.auditService.record({
        action: 'invoices.reconcile.failure',
        result: 'FAILURE',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: {
          action: invoice.processingAction,
          operationId: invoice.processingOperationId,
          detail: payload.detail,
        },
      });

      return {
        invoice: this.toInvoiceView(clearedInvoice),
        message: 'Invoice processing lock cleared after failed PAC reconciliation',
      };
    }

    const pacStatus =
      payload.resolution === 'CONFIRMED'
        ? this.buildManualPacStatus(invoice.processingAction, payload)
        : await this.pacService.getOperationStatus(invoice.processingOperationId);

    if (pacStatus.status === 'PENDING') {
      throw new ServiceUnavailableException('PAC operation is still pending confirmation');
    }

    if (pacStatus.status === 'FAILED') {
      const clearedInvoice = await this.clearPendingInvoiceOperationState(invoice.id);

      await this.auditService.record({
        action: 'invoices.reconcile.failure',
        result: 'FAILURE',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: {
          action: invoice.processingAction,
          operationId: invoice.processingOperationId,
          detail: pacStatus.detail ?? payload.detail,
        },
      });

      return {
        invoice: this.toInvoiceView(clearedInvoice),
        message: 'Invoice processing lock cleared after failed PAC reconciliation',
      };
    }

    return this.finalizeReconciledInvoice(invoice, pacStatus, session, metadata);
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

  private async assertCanAccessInvoice(
    currentRoles: UserRole[],
    actingUserId: string,
    invoiceUserId: string,
    metadata: RequestMetadata,
    invoiceId: string,
  ): Promise<void> {
    if (invoiceUserId === actingUserId) {
      return;
    }

    const canAccessForeignInvoice = currentRoles.some((role) =>
      this.crossUserInvoiceRoles.includes(role),
    );

    if (!canAccessForeignInvoice) {
      await this.auditService.record({
        action: 'invoices.access.denied',
        result: 'DENIED',
        userId: actingUserId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'invoice',
        entityId: invoiceId,
        metadata: {
          reason: 'cross-user-access',
          ownerUserId: invoiceUserId,
          roles: currentRoles,
        },
      });
      throw new ForbiddenException('Insufficient permissions to access this invoice');
    }
  }

  private assertInvoiceAmounts(subtotal: number, total: number): void {
    if (total < subtotal) {
      throw new BadRequestException('Invoice total must be greater than or equal to subtotal');
    }
  }

  private async acquireInvoiceProcessingLock(
    invoiceId: string,
    action: InvoiceProcessingAction,
    expectedStatus: InvoiceStatus | { in: InvoiceStatus[] },
    operationId: string,
  ): Promise<void> {
    const claim = await this.prismaService.invoice.updateMany({
      where: {
        id: invoiceId,
        processingAction: null,
        status: expectedStatus,
      },
      data: {
        processingAction: action,
        processingStartedAt: new Date(),
        processingOperationId: operationId,
        processingConfirmationRequired: false,
        processingErrorDetail: null,
      },
    });

    if (claim.count === 1) {
      return;
    }

    throw new ConflictException(
      action === InvoiceProcessingAction.STAMP
        ? 'Invoice is already being processed for stamping or no longer eligible'
        : 'Invoice is already being processed for cancellation or no longer eligible',
    );
  }

  private async releaseInvoiceProcessingLock(
    invoiceId: string,
    action: InvoiceProcessingAction,
  ): Promise<void> {
    await this.prismaService.invoice.updateMany({
      where: {
        id: invoiceId,
        processingAction: action,
      },
      data: {
        processingAction: null,
        processingStartedAt: null,
        processingOperationId: null,
        processingConfirmationRequired: false,
        processingErrorDetail: null,
      },
    });
  }

  private async markInvoiceProcessingConfirmationRequired(
    invoiceId: string,
    action: InvoiceProcessingAction,
    operationId: string,
    detail: string,
  ): Promise<void> {
    await this.prismaService.invoice.updateMany({
      where: {
        id: invoiceId,
        processingAction: action,
        processingOperationId: operationId,
      },
      data: {
        processingConfirmationRequired: true,
        processingErrorDetail: detail,
      },
    });
  }

  private async clearPendingInvoiceOperationState(
    invoiceId: string,
  ) {
    return this.prismaService.invoice.update({
      where: { id: invoiceId },
      data: {
        processingAction: null,
        processingStartedAt: null,
        processingOperationId: null,
        processingConfirmationRequired: false,
        processingErrorDetail: null,
      },
    });
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

  private generateProcessingOperationId(action: InvoiceProcessingAction): string {
    return `${action.toLowerCase()}_${randomUUID()}`;
  }

  private async reconcilePendingInvoiceIfNeeded(
    invoice: Invoice,
    action: InvoiceProcessingAction,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string } | null> {
    if (
      invoice.processingAction !== action ||
      !invoice.processingConfirmationRequired ||
      !invoice.processingOperationId
    ) {
      return null;
    }

    const pacStatus = await this.pacService.getOperationStatus(invoice.processingOperationId);

    if (pacStatus.status === 'PENDING') {
      throw new ServiceUnavailableException(
        'PAC operation is pending confirmation and cannot be retried yet',
      );
    }

    if (pacStatus.status === 'FAILED') {
      await this.clearPendingInvoiceOperationState(invoice.id);
      await this.auditService.record({
        action: `invoices.${action.toLowerCase()}.reconcile.failure`,
        result: 'FAILURE',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: {
          operationId: invoice.processingOperationId,
          detail: pacStatus.detail,
        },
      });

      throw new ConflictException(
        'Previous PAC operation failed and was cleared. Retry explicitly if needed.',
      );
    }

    return this.finalizeReconciledInvoice(invoice, pacStatus, session, metadata);
  }

  private async finalizeReconciledInvoice(
    invoice: Invoice,
    pacStatus: PacOperationStatusResult,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ invoice: InvoiceView; message: string }> {
    if (!invoice.processingAction) {
      throw new ConflictException('Invoice does not have a pending PAC operation');
    }

    if (invoice.processingAction === InvoiceProcessingAction.STAMP) {
      if (!pacStatus.pacReference) {
        throw new ServiceUnavailableException(
          'PAC reconciliation succeeded but did not return a stamp reference',
        );
      }

      const updatedInvoice = await this.prismaService.$transaction(async (tx) => {
        const stampedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.STAMPED,
            pacReference: pacStatus.pacReference,
            pacProvider: pacStatus.provider,
            stampedAt: pacStatus.stampedAt ?? new Date(),
            processingAction: null,
            processingStartedAt: null,
            processingOperationId: null,
            processingConfirmationRequired: false,
            processingErrorDetail: null,
          },
        });

        await tx.auditEvent.create({
          data: this.auditService.buildCreateData({
            action: 'invoices.stamp.reconcile.success',
            result: 'SUCCESS',
            userId: session.userId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            entityType: 'invoice',
            entityId: stampedInvoice.id,
            metadata: {
              pacReference: pacStatus.pacReference,
              pacProvider: pacStatus.provider,
              operationId: invoice.processingOperationId,
            },
          }),
        });

        return stampedInvoice;
      });

      return {
        invoice: this.toInvoiceView(updatedInvoice),
        message: 'Invoice stamped after PAC reconciliation',
      };
    }

    const cancellationRef = pacStatus.cancellationRef ?? this.generateCancellationReference();
    const updatedInvoice = await this.prismaService.$transaction(async (tx) => {
      const cancelledInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: pacStatus.cancelledAt ?? new Date(),
          cancellationRef,
          processingAction: null,
          processingStartedAt: null,
          processingOperationId: null,
          processingConfirmationRequired: false,
          processingErrorDetail: null,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'invoices.cancel.reconcile.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'invoice',
          entityId: cancelledInvoice.id,
          metadata: {
            cancellationRef,
            pacProvider: pacStatus.provider,
            operationId: invoice.processingOperationId,
          },
        }),
      });

      return cancelledInvoice;
    });

    return {
      invoice: this.toInvoiceView(updatedInvoice),
      message: 'Invoice cancelled after PAC reconciliation',
    };
  }

  private buildManualPacStatus(
    action: InvoiceProcessingAction,
    payload: ReconcileInvoiceProcessingDto,
  ): PacOperationStatusResult {
    if (action === InvoiceProcessingAction.STAMP && !payload.pacReference) {
      throw new ConflictException(
        'Manual confirmation of a stamped invoice requires pacReference',
      );
    }

    return {
      status: 'SUCCEEDED',
      provider: 'manual-reconciliation',
      pacReference: payload.pacReference,
      cancellationRef: payload.cancellationRef,
      detail: payload.detail,
    };
  }

  private toInvoiceView(invoice: Invoice): InvoiceView {
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
      processingAction: invoice.processingAction,
      processingStartedAt: invoice.processingStartedAt,
      processingOperationId: invoice.processingOperationId,
      processingConfirmationRequired: invoice.processingConfirmationRequired,
      processingErrorDetail: invoice.processingErrorDetail,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      stampedAt: invoice.stampedAt,
      cancelledAt: invoice.cancelledAt,
      cancellationRef: invoice.cancellationRef,
    };
  }
}

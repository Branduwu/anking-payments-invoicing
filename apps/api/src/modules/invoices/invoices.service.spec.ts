import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PacConfirmationRequiredException } from './pac.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  const auditService = {
    record: jest.fn(),
    buildCreateData: jest.fn((event: unknown) => event),
  };

  const pacService = {
    stampInvoice: jest.fn(),
    cancelInvoice: jest.fn(),
    getOperationStatus: jest.fn(),
  };

  const prismaService = {
    $transaction: jest.fn(),
    userRoleAssignment: {
      findMany: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: InvoicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.invoice.updateMany.mockResolvedValue({ count: 1 });
    prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        invoice: prismaService.invoice,
        auditEvent: prismaService.auditEvent,
      }),
    );
    service = new InvoicesService(
      prismaService as never,
      auditService as never,
      pacService as never,
    );
  });

  it('creates a draft invoice for an allowed role', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    prismaService.invoice.findUnique.mockResolvedValueOnce(null);
    prismaService.invoice.create.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
    });

    const result = await service.createInvoice(
      {
        customerTaxId: 'XAXX010101000',
        currency: 'MXN',
        subtotal: 100,
        total: 116,
      },
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'invoices.create.success',
        result: 'SUCCESS',
        entityId: 'inv_1',
      }),
    });
    expect(result.invoice.status).toBe(InvoiceStatus.DRAFT);
  });

  it('denies invoice listing without the required role', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.SECURITY }]);

    await expect(
      service.listInvoices(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'none',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stamps a draft invoice through the PAC service', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
    });
    pacService.stampInvoice.mockResolvedValue({
      pacReference: 'PAC-REF-123',
      provider: 'mock',
      stampedAt: new Date('2026-03-16T01:00:00.000Z'),
    });
    prismaService.invoice.update.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.STAMPED,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: 'PAC-REF-123',
      pacProvider: 'mock',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T01:00:00.000Z'),
      stampedAt: new Date('2026-03-16T01:00:00.000Z'),
      cancelledAt: null,
      cancellationRef: null,
    });

    const result = await service.stampInvoice(
      {
        invoiceId: 'inv_1',
      },
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(pacService.stampInvoice).toHaveBeenCalled();
    expect(result.invoice.status).toBe(InvoiceStatus.STAMPED);
    expect(result.invoice.pacReference).toBe('PAC-REF-123');
  });

  it('cancels a stamped invoice and persists PAC cancellation metadata', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.ADMIN }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.STAMPED,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: 'PAC-REF-123',
      pacProvider: 'mock',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T01:00:00.000Z'),
      stampedAt: new Date('2026-03-16T01:00:00.000Z'),
      cancelledAt: null,
      cancellationRef: null,
    });
    pacService.cancelInvoice.mockResolvedValue({
      cancellationRef: 'PAC-CANCEL-123',
      provider: 'mock',
      cancelledAt: new Date('2026-03-16T02:00:00.000Z'),
    });
    prismaService.invoice.update.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.CANCELLED,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: 'PAC-REF-123',
      pacProvider: 'mock',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T02:00:00.000Z'),
      stampedAt: new Date('2026-03-16T01:00:00.000Z'),
      cancelledAt: new Date('2026-03-16T02:00:00.000Z'),
      cancellationRef: 'PAC-CANCEL-123',
    });

    const result = await service.cancelInvoice(
      {
        invoiceId: 'inv_1',
        reason: 'Prueba',
      },
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(pacService.cancelInvoice).toHaveBeenCalled();
    expect(result.invoice.status).toBe(InvoiceStatus.CANCELLED);
    expect(result.invoice.cancellationRef).toBe('PAC-CANCEL-123');
  });

  it('rejects cancelling an already cancelled invoice', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.ADMIN }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.CANCELLED,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: 'PAC-REF-123',
      pacProvider: 'mock',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T02:00:00.000Z'),
      stampedAt: new Date('2026-03-16T01:00:00.000Z'),
      cancelledAt: new Date('2026-03-16T02:00:00.000Z'),
      cancellationRef: 'PAC-CANCEL-123',
    });

    await expect(
      service.cancelInvoice(
        {
          invoiceId: 'inv_1',
          reason: 'Duplicado',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invoicing a reversed payment', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    prismaService.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      userId: 'usr_1',
      currency: 'MXN',
      status: PaymentStatus.REVERSED,
    });

    await expect(
      service.createInvoice(
        {
          customerTaxId: 'XAXX010101000',
          currency: 'MXN',
          subtotal: 100,
          total: 116,
          paymentId: 'pay_1',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects stamping an invoice that is already being processed', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
      processingAction: null,
      processingStartedAt: null,
    });
    prismaService.invoice.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.stampInvoice(
        {
          invoiceId: 'inv_1',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pacService.stampInvoice).not.toHaveBeenCalled();
  });

  it('releases the invoice processing lock when stamping fails before PAC success', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
      processingAction: null,
      processingStartedAt: null,
    });
    pacService.stampInvoice.mockRejectedValue(new ConflictException('PAC unavailable'));

    await expect(
      service.stampInvoice(
        {
          invoiceId: 'inv_1',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.invoice.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'inv_1',
        processingAction: 'STAMP',
      },
      data: {
        processingAction: null,
        processingStartedAt: null,
        processingOperationId: null,
        processingConfirmationRequired: false,
        processingErrorDetail: null,
      },
    });
  });

  it('marks stamping as confirmation-required when PAC transport outcome is ambiguous', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_1',
      userId: 'usr_1',
      folio: 'INV-20260316-AAAAAA',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
      processingAction: null,
      processingStartedAt: null,
      processingOperationId: null,
      processingConfirmationRequired: false,
      processingErrorDetail: null,
    });
    pacService.stampInvoice.mockRejectedValue(
      new PacConfirmationRequiredException('stamp', 'custom-http', 'stamp_001'),
    );

    await expect(
      service.stampInvoice(
        {
          invoiceId: 'inv_1',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prismaService.invoice.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingConfirmationRequired: true,
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoices.stamp.confirmation_required',
        result: 'FAILURE',
      }),
    );
  });

  it('audits denied attempts to stamp an invoice from another user without cross-user access', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_2',
      userId: 'usr_owner',
      folio: 'INV-20260316-BBBBBB',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: null,
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
      processingAction: null,
      processingStartedAt: null,
    });

    await expect(
      service.stampInvoice(
        {
          invoiceId: 'inv_2',
        },
        {
          id: 'sess_1',
          userId: 'usr_operator',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_2',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoices.access.denied',
        result: 'DENIED',
        entityId: 'inv_2',
      }),
    );
    expect(pacService.stampInvoice).not.toHaveBeenCalled();
  });

  it('reconciles a pending stamp operation using PAC status', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    prismaService.invoice.findUnique.mockResolvedValue({
      id: 'inv_3',
      userId: 'usr_1',
      folio: 'INV-20260316-CCCCCC',
      status: InvoiceStatus.DRAFT,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: null,
      pacProvider: 'custom-http',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      stampedAt: null,
      cancelledAt: null,
      cancellationRef: null,
      processingAction: 'STAMP',
      processingStartedAt: new Date('2026-03-16T00:01:00.000Z'),
      processingOperationId: 'stamp_003',
      processingConfirmationRequired: true,
      processingErrorDetail: 'PAC stamp outcome requires confirmation before retrying',
    });
    pacService.getOperationStatus.mockResolvedValue({
      status: 'SUCCEEDED',
      provider: 'custom-http',
      pacReference: 'PAC-REF-003',
      stampedAt: new Date('2026-03-16T00:02:00.000Z'),
    });
    prismaService.invoice.update.mockResolvedValue({
      id: 'inv_3',
      userId: 'usr_1',
      folio: 'INV-20260316-CCCCCC',
      status: InvoiceStatus.STAMPED,
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('116.00'),
      pacReference: 'PAC-REF-003',
      pacProvider: 'custom-http',
      paymentId: null,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:02:00.000Z'),
      stampedAt: new Date('2026-03-16T00:02:00.000Z'),
      cancelledAt: null,
      cancellationRef: null,
      processingAction: null,
      processingStartedAt: null,
      processingOperationId: null,
      processingConfirmationRequired: false,
      processingErrorDetail: null,
    });

    const result = await service.reconcileInvoiceProcessing(
      {
        invoiceId: 'inv_3',
      },
      {
        id: 'sess_1',
        userId: 'usr_finance',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_3',
        ipAddress: '127.0.0.1',
      },
    );

    expect(result.invoice.status).toBe(InvoiceStatus.STAMPED);
    expect(result.message).toContain('reconciliation');
    expect(auditService.buildCreateData).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoices.stamp.reconcile.success',
      }),
    );
  });
});

import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const auditService = {
    record: jest.fn(),
    buildCreateData: jest.fn((event: unknown) => event),
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
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: prismaService.payment,
        auditEvent: prismaService.auditEvent,
      }),
    );
    service = new PaymentsService(prismaService as never, auditService as never);
  });

  it('creates a payment when the user has an allowed role', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.payment.create.mockResolvedValue({
      id: 'pay_1',
      userId: 'usr_1',
      amount: new Prisma.Decimal('125.50'),
      currency: 'MXN',
      status: PaymentStatus.PENDING,
      bankAccountRef: 'acct_123',
      externalReference: 'ext_1',
      concept: 'Cobro inicial',
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
      settledAt: null,
    });

    const result = await service.createPayment(
      {
        amount: 125.5,
        currency: 'MXN',
        bankAccountRef: 'acct_123',
        externalReference: 'ext_1',
        concept: 'Cobro inicial',
      },
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
    );

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(prismaService.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'usr_1',
        amount: expect.any(Prisma.Decimal),
        currency: 'MXN',
        bankAccountRef: 'acct_123',
      }),
    });
    expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'payments.create.success',
        result: 'SUCCESS',
        entityId: 'pay_1',
      }),
    });
    expect(result.payment.amount).toBe('125.50');
  });

  it('denies payment creation when the user role is insufficient', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.SECURITY }]);

    await expect(
      service.createPayment(
        {
          amount: 10,
          currency: 'MXN',
          bankAccountRef: 'acct_123',
        },
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

  it('fails closed on denied payment creation if audit persistence becomes unavailable', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.SECURITY }]);
    auditService.record.mockRejectedValue(new ServiceUnavailableException('Audit unavailable'));

    await expect(
      service.createPayment(
        {
          amount: 10,
          currency: 'MXN',
          bankAccountRef: 'acct_123',
        },
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
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lists all payments for finance-like roles', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    prismaService.payment.findMany.mockResolvedValue([
      {
        id: 'pay_1',
        userId: 'usr_1',
        amount: new Prisma.Decimal('50.00'),
        currency: 'MXN',
        status: PaymentStatus.PENDING,
        bankAccountRef: 'acct_123',
        externalReference: null,
        concept: null,
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        updatedAt: new Date('2026-03-16T00:00:00.000Z'),
        settledAt: null,
      },
    ]);

    const result = await service.listPayments(
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
    );

    expect(prismaService.payment.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.scope).toBe('all');
    expect(result.items[0].amount).toBe('50.00');
  });
});

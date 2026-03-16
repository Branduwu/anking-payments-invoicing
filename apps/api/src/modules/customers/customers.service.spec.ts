import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerStatus, UserRole } from '@prisma/client';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  const auditService = {
    record: jest.fn(),
    buildCreateData: jest.fn((event: unknown) => event),
  };

  const prismaService = {
    $transaction: jest.fn(),
    userRoleAssignment: {
      findMany: jest.fn(),
    },
    customer: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
  };

  const redisService = {
    isAvailable: jest.fn(),
    client: {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn().mockReturnValue('platform'),
  };

  let service: CustomersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        customer: prismaService.customer,
        auditEvent: prismaService.auditEvent,
      }),
    );
    redisService.isAvailable.mockReturnValue(false);
    service = new CustomersService(
      prismaService as never,
      auditService as never,
      redisService as never,
      configService as never,
    );
  });

  it('creates a customer and invalidates cache', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);
    prismaService.customer.create.mockResolvedValue({
      id: 'cus_1',
      userId: 'usr_1',
      name: 'Acme SA',
      taxId: 'XAXX010101000',
      email: 'facturas@acme.test',
      phone: '5555555555',
      status: CustomerStatus.ACTIVE,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
    });

    const result = await service.createCustomer(
      {
        name: 'Acme SA',
        taxId: 'xaxx010101000',
        email: 'FACTURAS@ACME.TEST',
        phone: '5555555555',
      },
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(),
        absoluteExpiresAt: new Date(),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(prismaService.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'usr_1',
        taxId: 'XAXX010101000',
        email: 'facturas@acme.test',
      }),
    });
    expect(result.customer.taxId).toBe('XAXX010101000');
  });

  it('returns cached customer lists when redis has data', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    redisService.isAvailable.mockReturnValue(true);
    redisService.client.get.mockResolvedValue(
      JSON.stringify([
        {
          id: 'cus_1',
          userId: 'usr_1',
          name: 'Acme SA',
          taxId: 'XAXX010101000',
          email: null,
          phone: null,
          status: CustomerStatus.ACTIVE,
          createdAt: '2026-03-16T00:00:00.000Z',
          updatedAt: '2026-03-16T00:00:00.000Z',
        },
      ]),
    );

    const result = await service.listCustomers(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(),
        absoluteExpiresAt: new Date(),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(prismaService.customer.findMany).not.toHaveBeenCalled();
    expect(result.source).toBe('cache');
    expect(result.scope).toBe('all');
  });

  it('reads a customer from the database and writes it to cache', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.FINANCE }]);
    redisService.isAvailable.mockReturnValue(true);
    redisService.client.get.mockResolvedValue(null);
    prismaService.customer.findUnique.mockResolvedValue({
      id: 'cus_1',
      userId: 'usr_2',
      name: 'Acme SA',
      taxId: 'XAXX010101000',
      email: null,
      phone: null,
      status: CustomerStatus.ACTIVE,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
    });

    const result = await service.getCustomerById(
      'cus_1',
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(),
        absoluteExpiresAt: new Date(),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(result.source).toBe('database');
    expect(redisService.client.set).toHaveBeenCalled();
  });

  it('denies customer listing to users without an allowed role', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.SECURITY }]);

    await expect(
      service.listCustomers(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'none',
          createdAt: new Date(),
          lastActivity: new Date(),
          expiresAt: new Date(),
          absoluteExpiresAt: new Date(),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws not found when updating a missing customer', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.ADMIN }]);
    prismaService.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.updateCustomer(
        'cus_missing',
        {
          name: 'Nuevo nombre',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'none',
          createdAt: new Date(),
          lastActivity: new Date(),
          expiresAt: new Date(),
          absoluteExpiresAt: new Date(),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate tax ID errors to a conflict', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.ADMIN }]);
    prismaService.customer.findUnique.mockResolvedValue({
      id: 'cus_1',
      userId: 'usr_1',
      name: 'Acme SA',
      taxId: 'XAXX010101000',
      email: null,
      phone: null,
      status: CustomerStatus.ACTIVE,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      updatedAt: new Date('2026-03-16T00:00:00.000Z'),
    });
    prismaService.customer.update.mockRejectedValue({
      code: 'P2002',
      constructor: { name: 'PrismaClientKnownRequestError' },
    });

    await expect(
      service.updateCustomer(
        'cus_1',
        {
          taxId: 'XEXX010101000',
        },
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'none',
          createdAt: new Date(),
          lastActivity: new Date(),
          expiresAt: new Date(),
          absoluteExpiresAt: new Date(),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

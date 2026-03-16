import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerStatus, Prisma, UserRole } from '@prisma/client';
import type { RequestMetadata } from '../../common/http/request-metadata';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import type { ActiveSession } from '../sessions/session.types';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
import type { CustomerScope, CustomerSource, CustomerView } from './customer.types';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);
  private readonly createCustomerRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.OPERATOR,
  ];
  private readonly listAllCustomersRoles: UserRole[] = [
    UserRole.ADMIN,
    UserRole.AUDITOR,
    UserRole.FINANCE,
  ];
  private readonly manageAllCustomersRoles: UserRole[] = [UserRole.ADMIN, UserRole.FINANCE];
  private readonly cacheTtlSeconds = 60;
  private readonly redisKeyPrefix: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.redisKeyPrefix =
      configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
  }

  async createCustomer(
    payload: CreateCustomerDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ customer: CustomerView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    await this.assertCanCreateCustomer(roles, session.userId, metadata);

    const normalizedPayload = this.normalizeCreatePayload(payload);

    try {
      const customer = await this.prismaService.$transaction(async (tx) => {
        const createdCustomer = await tx.customer.create({
          data: {
            userId: session.userId,
            ...normalizedPayload,
            status: normalizedPayload.status ?? CustomerStatus.ACTIVE,
          },
        });

        await tx.auditEvent.create({
          data: this.auditService.buildCreateData({
            action: 'customers.create.success',
            result: 'SUCCESS',
            userId: session.userId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            entityType: 'customer',
            entityId: createdCustomer.id,
            metadata: {
              taxId: createdCustomer.taxId,
              status: createdCustomer.status,
            },
          }),
        });

        return createdCustomer;
      });

      await this.invalidateCustomerCache(customer.id, customer.userId);

      return {
        customer: this.toCustomerView(customer),
        message: 'Customer created',
      };
    } catch (error) {
      if (this.isDuplicateTaxIdError(error)) {
        throw new ConflictException('Customer tax ID already exists for this user');
      }

      throw error;
    }
  }

  async listCustomers(
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ items: CustomerView[]; scope: CustomerScope; source: CustomerSource }> {
    const roles = await this.getUserRoles(session.userId);
    const scope = await this.resolveReadableScope(roles, session.userId, metadata);
    const cacheKey = this.getCustomerListCacheKey(scope, session.userId);
    const cached = await this.readCache<unknown[]>(cacheKey);

    if (cached) {
      return {
        items: cached.map((entry) => this.hydrateCustomerView(entry)),
        scope,
        source: 'cache',
      };
    }

    const customers = await this.prismaService.customer.findMany({
      where: scope === 'all' ? undefined : { userId: session.userId },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const items = customers.map((customer) => this.toCustomerView(customer));
    await this.writeCache(cacheKey, items);

    return {
      items,
      scope,
      source: 'database',
    };
  }

  async getCustomerById(
    customerId: string,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ customer: CustomerView; source: CustomerSource }> {
    const roles = await this.getUserRoles(session.userId);
    const cached = await this.readCache<unknown>(this.getCustomerCacheKey(customerId));

    if (cached) {
      const cachedCustomer = this.hydrateCustomerView(cached);
      await this.assertCanAccessCustomer(
        cachedCustomer.userId,
        roles,
        session.userId,
        metadata,
        customerId,
      );

      return {
        customer: cachedCustomer,
        source: 'cache',
      };
    }

    const customer = await this.prismaService.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.assertCanAccessCustomer(customer.userId, roles, session.userId, metadata, customer.id);

    const view = this.toCustomerView(customer);
    await this.writeCache(this.getCustomerCacheKey(customer.id), view);

    return {
      customer: view,
      source: 'database',
    };
  }

  async updateCustomer(
    customerId: string,
    payload: UpdateCustomerDto,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ customer: CustomerView; message: string }> {
    const roles = await this.getUserRoles(session.userId);
    const customer = await this.prismaService.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.assertCanManageCustomer(
      customer.userId,
      roles,
      session.userId,
      metadata,
      customer.id,
      'customers.update.denied',
    );

    const normalizedPayload = this.normalizeUpdatePayload(payload);

    try {
      const updatedCustomer = await this.prismaService.$transaction(async (tx) => {
        const record = await tx.customer.update({
          where: { id: customerId },
          data: normalizedPayload,
        });

        await tx.auditEvent.create({
          data: this.auditService.buildCreateData({
            action: 'customers.update.success',
            result: 'SUCCESS',
            userId: session.userId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            entityType: 'customer',
            entityId: record.id,
            metadata: {
              taxId: record.taxId,
              status: record.status,
            },
          }),
        });

        return record;
      });

      await this.invalidateCustomerCache(updatedCustomer.id, updatedCustomer.userId);

      return {
        customer: this.toCustomerView(updatedCustomer),
        message: 'Customer updated',
      };
    } catch (error) {
      if (this.isDuplicateTaxIdError(error)) {
        throw new ConflictException('Customer tax ID already exists for this user');
      }

      throw error;
    }
  }

  async deleteCustomer(
    customerId: string,
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<{ message: string }> {
    const roles = await this.getUserRoles(session.userId);
    const customer = await this.prismaService.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.assertCanManageCustomer(
      customer.userId,
      roles,
      session.userId,
      metadata,
      customer.id,
      'customers.delete.denied',
    );

    await this.prismaService.$transaction(async (tx) => {
      await tx.customer.delete({
        where: { id: customerId },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'customers.delete.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'customer',
          entityId: customer.id,
          metadata: {
            taxId: customer.taxId,
          },
        }),
      });
    });

    await this.invalidateCustomerCache(customer.id, customer.userId);

    return {
      message: 'Customer deleted',
    };
  }

  private async getUserRoles(userId: string): Promise<UserRole[]> {
    const roles = await this.prismaService.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });

    return roles.map((entry) => entry.role);
  }

  private async resolveReadableScope(
    roles: UserRole[],
    userId: string,
    metadata: RequestMetadata,
  ): Promise<CustomerScope> {
    const canListAll = roles.some((role) => this.listAllCustomersRoles.includes(role));
    const canListOwn = canListAll || roles.some((role) => this.createCustomerRoles.includes(role));

    if (!canListOwn) {
      await this.auditService.record({
        action: 'customers.list.denied',
        result: 'DENIED',
        userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'customer',
        metadata: {
          reason: 'insufficient-role',
          roles,
        },
      });
      throw new ForbiddenException('Insufficient permissions to list customers');
    }

    return canListAll ? 'all' : 'own';
  }

  private async assertCanCreateCustomer(
    roles: UserRole[],
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const allowed = roles.some((role) => this.createCustomerRoles.includes(role));

    if (allowed) {
      return;
    }

    await this.auditService.record({
      action: 'customers.create.denied',
      result: 'DENIED',
      userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'customer',
      metadata: {
        reason: 'insufficient-role',
        roles,
      },
    });

    throw new ForbiddenException('Insufficient permissions to create customers');
  }

  private async assertCanAccessCustomer(
    ownerUserId: string,
    roles: UserRole[],
    currentUserId: string,
    metadata: RequestMetadata,
    customerId: string,
  ): Promise<void> {
    const canReadAll = roles.some((role) => this.listAllCustomersRoles.includes(role));
    const canAccessOwn =
      canReadAll ||
      (ownerUserId === currentUserId &&
        roles.some((role) => this.createCustomerRoles.includes(role)));

    if (canAccessOwn) {
      return;
    }

    await this.auditService.record({
      action: 'customers.read.denied',
      result: 'DENIED',
      userId: currentUserId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'customer',
      entityId: customerId,
      metadata: {
        reason: 'insufficient-role',
        roles,
      },
    });

    throw new ForbiddenException('Insufficient permissions to access customer');
  }

  private async assertCanManageCustomer(
    ownerUserId: string,
    roles: UserRole[],
    currentUserId: string,
    metadata: RequestMetadata,
    customerId: string,
    deniedAction: string,
  ): Promise<void> {
    const canManageAll = roles.some((role) => this.manageAllCustomersRoles.includes(role));
    const canManageOwn =
      canManageAll || (ownerUserId === currentUserId && roles.includes(UserRole.OPERATOR));

    if (canManageOwn) {
      return;
    }

    await this.auditService.record({
      action: deniedAction,
      result: 'DENIED',
      userId: currentUserId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'customer',
      entityId: customerId,
      metadata: {
        reason: 'insufficient-role',
        roles,
      },
    });

    throw new ForbiddenException('Insufficient permissions to manage customer');
  }

  private normalizeCreatePayload(payload: CreateCustomerDto): {
    name: string;
    taxId: string;
    email?: string | null;
    phone?: string | null;
    status?: CustomerStatus;
  } {
    return {
      name: payload.name.trim(),
      taxId: payload.taxId.trim().toUpperCase(),
      email: this.normalizeOptionalValue(payload.email?.toLowerCase()),
      phone: this.normalizeOptionalValue(payload.phone),
      status: payload.status,
    };
  }

  private normalizeUpdatePayload(payload: UpdateCustomerDto): Prisma.CustomerUpdateInput {
    const data: Prisma.CustomerUpdateInput = {};

    if (payload.name !== undefined) {
      data.name = payload.name.trim();
    }

    if (payload.taxId !== undefined) {
      data.taxId = payload.taxId.trim().toUpperCase();
    }

    if (payload.email !== undefined) {
      data.email = this.normalizeOptionalValue(payload.email?.toLowerCase());
    }

    if (payload.phone !== undefined) {
      data.phone = this.normalizeOptionalValue(payload.phone);
    }

    if (payload.status !== undefined) {
      data.status = payload.status;
    }

    return data;
  }

  private normalizeOptionalValue(value?: string | null): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toCustomerView(customer: {
    id: string;
    userId: string;
    name: string;
    taxId: string;
    email: string | null;
    phone: string | null;
    status: CustomerStatus;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerView {
    return {
      id: customer.id,
      userId: customer.userId,
      name: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private hydrateCustomerView(value: unknown): CustomerView {
    const customer = value as Omit<CustomerView, 'createdAt' | 'updatedAt'> & {
      createdAt: string | Date;
      updatedAt: string | Date;
    };

    return {
      ...customer,
      createdAt: new Date(customer.createdAt),
      updatedAt: new Date(customer.updatedAt),
    };
  }

  private getCustomerCacheKey(customerId: string): string {
    return `${this.redisKeyPrefix}:customers:${customerId}`;
  }

  private getCustomerListCacheKey(scope: CustomerScope, userId: string): string {
    return scope === 'all'
      ? `${this.redisKeyPrefix}:customers:list:all`
      : `${this.redisKeyPrefix}:customers:list:user:${userId}`;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    if (!this.redisService.isAvailable()) {
      return null;
    }

    try {
      const cached = await this.redisService.client.get(key);
      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.warn(
        `No se pudo leer cache de customers en Redis: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }

    try {
      await this.redisService.client.set(
        key,
        JSON.stringify(value),
        'EX',
        this.cacheTtlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo escribir cache de customers en Redis: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async invalidateCustomerCache(customerId: string, userId: string): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }

    try {
      await this.redisService.client.del(
        this.getCustomerCacheKey(customerId),
        this.getCustomerListCacheKey('own', userId),
        this.getCustomerListCacheKey('all', userId),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo invalidar cache de customers en Redis: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private isDuplicateTaxIdError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}

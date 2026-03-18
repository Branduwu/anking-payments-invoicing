import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type AuditResultValue = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface AuditEventInput {
  action: string;
  result: AuditResultValue;
  userId?: string;
  requestId?: string;
  ipAddress?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditRecordOptions {
  failClosed?: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async record(event: AuditEventInput, options?: AuditRecordOptions): Promise<void> {
    const failClosed = this.resolveFailClosed(event, options);

    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ...event,
      }),
    );

    try {
      if (!this.prismaService.isAvailable()) {
        throw new Error('Prisma audit persistence is unavailable');
      }

      await this.prismaService.auditEvent.create({
        data: this.buildCreateData(event),
      });
    } catch (error) {
      this.logger.error(
        `No se pudo persistir evento de auditoria: ${event.action}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (failClosed) {
        throw new ServiceUnavailableException('Audit persistence unavailable');
      }
    }
  }

  buildCreateData(event: AuditEventInput) {
    return {
      userId: event.userId,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      action: event.action,
      result: event.result,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: this.sanitizeMetadata(event.metadata),
    };
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(metadata));
  }

  private resolveFailClosed(event: AuditEventInput, options?: AuditRecordOptions): boolean {
    if (typeof options?.failClosed === 'boolean') {
      return options.failClosed;
    }

    const failClosedDefault =
      this.configService.get<boolean>('app.audit.failClosedDefault', { infer: true }) ?? false;

    if (failClosedDefault) {
      return true;
    }

    const prefixes = this.getConfiguredPrefixes(event.result);
    return prefixes.some((prefix: string) => event.action.startsWith(prefix));
  }

  private getConfiguredPrefixes(result: AuditResultValue): string[] {
    const configKey =
      result === 'SUCCESS'
        ? 'app.audit.failClosedSuccessActionPrefixes'
        : result === 'FAILURE'
          ? 'app.audit.failClosedFailureActionPrefixes'
          : 'app.audit.failClosedDeniedActionPrefixes';

    const configuredPrefixes = this.configService.get<string[] | string>(configKey, {
      infer: true,
    });

    const normalized = Array.isArray(configuredPrefixes)
      ? configuredPrefixes
      : typeof configuredPrefixes === 'string'
        ? configuredPrefixes
            .split(',')
            .map((prefix) => prefix.trim())
            .filter(Boolean)
        : [];

    if (normalized.length > 0) {
      return normalized;
    }

    if (result === 'SUCCESS') {
      const legacyPrefixes = this.configService.get<string[] | string>(
        'app.audit.failClosedActionPrefixes',
        {
          infer: true,
        },
      );

      return Array.isArray(legacyPrefixes)
        ? legacyPrefixes
        : typeof legacyPrefixes === 'string'
          ? legacyPrefixes
              .split(',')
              .map((prefix) => prefix.trim())
              .filter(Boolean)
          : [];
    }

    return [];
  }
}

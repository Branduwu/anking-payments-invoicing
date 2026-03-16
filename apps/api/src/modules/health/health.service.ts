import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

type DependencyStatus = 'up' | 'down';

export interface DependencyHealthCheck {
  name: 'postgresql' | 'redis';
  status: DependencyStatus;
  latencyMs?: number;
  detail?: string;
}

export interface HealthPayload {
  status: 'ok' | 'ready' | 'degraded';
  timestamp: string;
  service: {
    name: string;
    version: string;
    commitSha: string;
    environment: string;
    uptimeSeconds: number;
    degradedStartupAllowed: boolean;
  };
  checks?: DependencyHealthCheck[];
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  getLiveness(): HealthPayload {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: this.getServiceMetadata(),
    };
  }

  async getReadiness(): Promise<HealthPayload> {
    const checks = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const hasUnavailableDependency = checks.some((check) => check.status === 'down');

    return {
      status: hasUnavailableDependency ? 'degraded' : 'ready',
      timestamp: new Date().toISOString(),
      service: this.getServiceMetadata(),
      checks,
    };
  }

  private async checkDatabase(): Promise<DependencyHealthCheck> {
    const startedAt = Date.now();

    if (!this.prismaService.isAvailable()) {
      return {
        name: 'postgresql',
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: 'Prisma connection unavailable',
      };
    }

    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      this.prismaService.markAvailable();

      return {
        name: 'postgresql',
        status: 'up',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      this.prismaService.markUnavailable();

      return {
        name: 'postgresql',
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: this.asDependencyDetail(error),
      };
    }
  }

  private async checkRedis(): Promise<DependencyHealthCheck> {
    const startedAt = Date.now();

    if (!this.redisService.isAvailable()) {
      return {
        name: 'redis',
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: 'Redis connection unavailable',
      };
    }

    try {
      await this.redisService.ping();
      this.redisService.markAvailable();

      return {
        name: 'redis',
        status: 'up',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      this.redisService.markUnavailable();

      return {
        name: 'redis',
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: this.asDependencyDetail(error),
      };
    }
  }

  private getServiceMetadata(): HealthPayload['service'] {
    return {
      name: this.configService.get<string>('app.name', { infer: true }) ?? 'banking-platform-api',
      version: this.configService.get<string>('app.version', { infer: true }) ?? '0.1.0',
      commitSha: this.configService.get<string>('app.commitSha', { infer: true }) ?? 'local',
      environment: this.configService.get<string>('app.env', { infer: true }) ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      degradedStartupAllowed:
        this.configService.get<boolean>('app.runtime.allowDegradedStartup', { infer: true }) ??
        false,
    };
  }

  private asDependencyDetail(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'unknown dependency error';
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private available = false;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.available = true;
    } catch (error) {
      if (!this.allowDegradedStartup()) {
        throw error;
      }

      this.available = false;
      this.logger.warn(
        `Prisma no pudo conectarse al iniciar. La API seguira en modo degradado: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  isAvailable(): boolean {
    return this.available;
  }

  markAvailable(): void {
    this.available = true;
  }

  markUnavailable(): void {
    this.available = false;
  }

  private allowDegradedStartup(): boolean {
    return this.configService.get<boolean>('app.runtime.allowDegradedStartup', { infer: true }) ?? false;
  }
}

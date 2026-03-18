import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private available = false;
  private reconnectPromise: Promise<boolean> | null = null;

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

  async ensureConnected(): Promise<boolean> {
    if (this.available) {
      return true;
    }

    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    this.reconnectPromise = this.reconnect().finally(() => {
      this.reconnectPromise = null;
    });

    return this.reconnectPromise;
  }

  private allowDegradedStartup(): boolean {
    return this.configService.get<boolean>('app.runtime.allowDegradedStartup', { infer: true }) ?? false;
  }

  private async reconnect(): Promise<boolean> {
    try {
      await this.$connect();
      this.available = true;
      return true;
    } catch (error) {
      this.available = false;

      if (this.allowDegradedStartup()) {
        this.logger.warn(
          `Prisma sigue sin recuperarse desde modo degradado: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return false;
      }

      throw error;
    }
  }
}

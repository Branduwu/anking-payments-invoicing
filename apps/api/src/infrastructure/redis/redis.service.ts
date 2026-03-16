import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly degradedStartupAllowed: boolean;
  private available = false;
  private degradedConnectionWarningShown = false;
  readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('app.data.redisUrl', { infer: true }) ?? 'redis://localhost:6379';
    this.degradedStartupAllowed = this.allowDegradedStartup();

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: !this.degradedStartupAllowed,
      retryStrategy: this.degradedStartupAllowed
        ? () => null
        : (times) => Math.min(times * 250, 2_000),
      enableOfflineQueue: !this.degradedStartupAllowed,
    });

    this.client.on('error', (error) => {
      const message = error instanceof Error && error.message ? error.message : 'connection unavailable';

      if (this.degradedStartupAllowed && !this.available) {
        if (!this.degradedConnectionWarningShown) {
          this.degradedConnectionWarningShown = true;
          this.logger.warn(`Redis no esta disponible en modo degradado: ${message}`);
        }
        return;
      }

      this.logger.error(`Redis connection error: ${message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status !== 'wait') {
      return;
    }

    try {
      await this.client.connect();
      this.available = true;
    } catch (error) {
      if (!this.allowDegradedStartup()) {
        throw error;
      }

      this.available = false;
      this.degradedConnectionWarningShown = true;
      this.client.disconnect();
      this.logger.warn(
        `Redis no pudo conectarse al iniciar. La API seguira en modo degradado: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  isAvailable(): boolean {
    return this.available;
  }

  assertAvailable(): void {
    if (!this.available) {
      throw new ServiceUnavailableException('Redis session store unavailable');
    }
  }

  private allowDegradedStartup(): boolean {
    return this.configService.get<boolean>('app.runtime.allowDegradedStartup', { infer: true }) ?? false;
  }
}

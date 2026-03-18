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
  private readonly redisUrl: string;
  private readonly degradedStartupAllowed: boolean;
  private available = false;
  private degradedConnectionWarningShown = false;
  private reconnectPromise: Promise<boolean> | null = null;
  client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redisUrl =
      this.configService.get<string>('app.data.redisUrl', { infer: true }) ?? 'redis://localhost:6379';
    this.degradedStartupAllowed = this.allowDegradedStartup();
    this.client = this.createClient();
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
    await this.ensureConnected();
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
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

  assertAvailable(): void {
    if (!this.available) {
      throw new ServiceUnavailableException('Redis session store unavailable');
    }
  }

  async ensureAvailable(): Promise<void> {
    const connected = await this.ensureConnected();

    if (!connected || !this.available || this.client.status !== 'ready') {
      throw new ServiceUnavailableException('Redis session store unavailable');
    }
  }

  async ensureConnected(): Promise<boolean> {
    if (this.available && this.client.status === 'ready') {
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

  private createClient(): Redis {
    const client = new Redis(this.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: !this.degradedStartupAllowed,
      retryStrategy: this.degradedStartupAllowed
        ? () => null
        : (times) => Math.min(times * 250, 2_000),
      enableOfflineQueue: !this.degradedStartupAllowed,
    });

    client.on('ready', () => {
      this.available = true;
      this.degradedConnectionWarningShown = false;
    });
    client.on('end', () => {
      this.available = false;
    });
    client.on('close', () => {
      this.available = false;
    });
    client.on('error', (error) => {
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

    return client;
  }

  private async reconnect(): Promise<boolean> {
    try {
      const status = this.client.status;

      if (status === 'ready') {
        this.available = true;
        return true;
      }

      if (status === 'connecting' || status === 'connect' || status === 'reconnecting') {
        await this.client.ping();
        this.available = true;
        return true;
      }

      if (status === 'end') {
        this.client = this.createClient();
      }

      await this.client.connect();
      this.available = true;
      return true;
    } catch (error) {
      this.available = false;

      if (this.degradedStartupAllowed) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Redis sigue sin recuperarse desde modo degradado: ${message}`);
        return false;
      }

      throw error;
    }
  }
}

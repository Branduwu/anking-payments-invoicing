import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infrastructure/redis/redis.service';

type AuthRateLimitScope = 'login' | 'reauth';

@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async assertLoginAllowed(email: string, ipAddress?: string): Promise<void> {
    await this.assertScopeAllowed(
      'login',
      this.getLoginRateLimitMaxAttempts(),
      'Too many login attempts. Try again later.',
      this.getLoginActors(email, ipAddress),
    );
  }

  async registerLoginFailure(email: string, ipAddress?: string): Promise<void> {
    await this.registerFailure(
      'login',
      this.getLoginRateLimitMaxAttempts(),
      this.getLoginActors(email, ipAddress),
    );
  }

  async clearLoginFailures(email: string, ipAddress?: string): Promise<void> {
    await this.clearScope('login', this.getLoginActors(email, ipAddress));
  }

  async assertReauthenticationAllowed(userId: string, ipAddress?: string): Promise<void> {
    await this.assertScopeAllowed(
      'reauth',
      this.getReauthRateLimitMaxAttempts(),
      'Too many reauthentication attempts. Try again later.',
      this.getReauthActors(userId, ipAddress),
    );
  }

  async registerReauthenticationFailure(userId: string, ipAddress?: string): Promise<void> {
    await this.registerFailure(
      'reauth',
      this.getReauthRateLimitMaxAttempts(),
      this.getReauthActors(userId, ipAddress),
    );
  }

  async clearReauthenticationFailures(userId: string, ipAddress?: string): Promise<void> {
    await this.clearScope('reauth', this.getReauthActors(userId, ipAddress));
  }

  private async assertScopeAllowed(
    scope: AuthRateLimitScope,
    maxAttempts: number,
    message: string,
    actors: string[],
  ): Promise<void> {
    this.redisService.assertAvailable();

    for (const actor of actors) {
      const rawValue = await this.redisService.client.get(this.getScopeKey(scope, actor));
      const attempts = rawValue ? Number(rawValue) : 0;

      if (attempts >= maxAttempts) {
        throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  private async registerFailure(
    scope: AuthRateLimitScope,
    maxAttempts: number,
    actors: string[],
  ): Promise<void> {
    this.redisService.assertAvailable();

    for (const actor of actors) {
      const key = this.getScopeKey(scope, actor);
      const attempts = await this.redisService.client.incr(key);

      if (attempts === 1) {
        await this.redisService.client.expire(key, this.getRateLimitWindowSeconds());
      }

      if (attempts > maxAttempts) {
        await this.redisService.client.expire(key, this.getRateLimitWindowSeconds());
      }
    }
  }

  private async clearScope(scope: AuthRateLimitScope, actors: string[]): Promise<void> {
    this.redisService.assertAvailable();

    const keys = actors.map((actor) => this.getScopeKey(scope, actor));
    if (keys.length === 0) {
      return;
    }

    await this.redisService.client.del(...keys);
  }

  private getScopeKey(scope: AuthRateLimitScope, actor: string): string {
    const prefix =
      this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
    return `${prefix}:auth_rate_limit:${scope}:${actor}`;
  }

  private getLoginActors(email: string, ipAddress?: string): string[] {
    const actors = [`email:${email.trim().toLowerCase()}`];
    if (ipAddress) {
      actors.push(`ip:${ipAddress}`);
    }

    return actors;
  }

  private getReauthActors(userId: string, ipAddress?: string): string[] {
    const actors = [`user:${userId}`];
    if (ipAddress) {
      actors.push(`ip:${ipAddress}`);
    }

    return actors;
  }

  private getRateLimitWindowSeconds(): number {
    const minutes =
      this.configService.get<number>('app.auth.rateLimitWindowMinutes', {
        infer: true,
      }) ?? 10;
    return minutes * 60;
  }

  private getLoginRateLimitMaxAttempts(): number {
    return this.configService.get<number>('app.auth.loginRateLimitMaxAttempts', {
      infer: true,
    }) ?? 10;
  }

  private getReauthRateLimitMaxAttempts(): number {
    return this.configService.get<number>('app.auth.reauthRateLimitMaxAttempts', {
      infer: true,
    }) ?? 5;
  }
}

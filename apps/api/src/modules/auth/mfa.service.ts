import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';

export type MfaThrottleScope = 'setup' | 'totp' | 'recovery';

export interface MfaThrottleContext {
  scope: MfaThrottleScope;
  actorId: string;
}

@Injectable()
export class MfaService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async createSetup(sessionId: string, email: string): Promise<MfaSetupResponseDto> {
    this.redisService.assertAvailable();
    const otp = this.getOtpLib();
    const secret = otp.generateSecret();
    const encryptedSecret = this.encryptSecret(secret);
    const issuer = this.configService.get<string>('app.name', { infer: true }) ?? 'banking-platform-api';
    const otpauthUrl = otp.generateURI({
      strategy: 'totp',
      issuer,
      label: email,
      secret,
      digits: 6,
      period: 30,
    });
    const expiresInSeconds = this.getSetupTtlSeconds();

    await this.redisService.client.set(
      this.getPendingSetupKey(sessionId),
      encryptedSecret,
      'EX',
      expiresInSeconds,
    );

    return {
      secret,
      otpauthUrl,
      issuer,
      accountName: email,
      expiresInSeconds,
    };
  }

  async verifyPendingSetup(sessionId: string, code: string): Promise<string | null> {
    this.redisService.assertAvailable();
    const encryptedSecret = await this.redisService.client.get(this.getPendingSetupKey(sessionId));

    if (!encryptedSecret) {
      return null;
    }

    const isValid = await this.verifyEncryptedSecret(encryptedSecret, code, {
      scope: 'setup',
      actorId: sessionId,
    });
    return isValid ? encryptedSecret : null;
  }

  async clearPendingSetup(sessionId: string): Promise<void> {
    this.redisService.assertAvailable();
    await this.redisService.client.del(this.getPendingSetupKey(sessionId));
  }

  async verifyEncryptedSecret(
    encryptedSecret: string,
    code: string,
    context?: MfaThrottleContext,
  ): Promise<boolean> {
    if (context) {
      await this.assertVerificationAllowed(context);
    }

    const secret = this.decryptSecret(encryptedSecret);
    const otp = this.getOtpLib();
    const result = await otp.verify({
      strategy: 'totp',
      token: this.normalizeCode(code),
      secret,
      digits: 6,
      period: 30,
    });

    if (context) {
      await this.registerVerificationResult(context, result.valid);
    }

    return result.valid;
  }

  generateRecoveryCodes(count = 8): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: count }, () => this.generateRecoveryCode());
    return {
      codes,
      hashes: codes.map((code) => this.hashRecoveryCode(code)),
    };
  }

  async consumeRecoveryCode(
    recoveryCodeHashes: string[],
    candidateCode: string,
    context?: MfaThrottleContext,
  ): Promise<{ matched: boolean; remainingHashes: string[] }> {
    if (context) {
      await this.assertVerificationAllowed(context);
    }

    const normalizedCandidateHash = this.hashRecoveryCode(candidateCode);
    const normalizedCandidateBuffer = Buffer.from(normalizedCandidateHash, 'hex');

    const matchedIndex = recoveryCodeHashes.findIndex((hash) => {
      const current = Buffer.from(hash, 'hex');
      return current.length === normalizedCandidateBuffer.length
        ? timingSafeEqual(current, normalizedCandidateBuffer)
        : false;
    });

    if (matchedIndex === -1) {
      if (context) {
        await this.registerVerificationResult(context, false);
      }

      return {
        matched: false,
        remainingHashes: recoveryCodeHashes,
      };
    }

    if (context) {
      await this.registerVerificationResult(context, true);
    }

    return {
      matched: true,
      remainingHashes: recoveryCodeHashes.filter((_, index) => index !== matchedIndex),
    };
  }

  private getOtpLib(): {
    generateSecret: (options?: unknown) => string;
    generateURI: (options: {
      strategy: 'totp';
      issuer: string;
      label: string;
      secret: string;
      digits: number;
      period: number;
    }) => string;
    verify: (options: {
      strategy: 'totp';
      token: string;
      secret: string;
      digits: number;
      period: number;
    }) => Promise<{ valid: boolean }>;
  } {
    return require('otplib') as {
      generateSecret: (options?: unknown) => string;
      generateURI: (options: {
        strategy: 'totp';
        issuer: string;
        label: string;
        secret: string;
        digits: number;
        period: number;
      }) => string;
      verify: (options: {
        strategy: 'totp';
        token: string;
        secret: string;
        digits: number;
        period: number;
      }) => Promise<{ valid: boolean }>;
    };
  }

  private encryptSecret(secret: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decryptSecret(payload: string): string {
    const [ivPart, tagPart, encryptedPart] = payload.split('.');
    if (!ivPart || !tagPart || !encryptedPart) {
      throw new UnauthorizedException('Stored MFA secret is invalid');
    }

    const key = this.getEncryptionKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private normalizeCode(code: string): string {
    return code.replace(/\s+/g, '');
  }

  private normalizeRecoveryCode(code: string): string {
    return code.replace(/[\s-]+/g, '').toUpperCase();
  }

  private generateRecoveryCode(): string {
    const raw = randomBytes(8).toString('hex').toUpperCase();
    return raw.match(/.{1,4}/g)?.join('-') ?? raw;
  }

  private hashRecoveryCode(code: string): string {
    const pepper =
      this.configService.get<string>('app.auth.mfaEncryptionKey', { infer: true }) ?? '';
    return createHash('sha256')
      .update(`${pepper}:${this.normalizeRecoveryCode(code)}`)
      .digest('hex');
  }

  private getEncryptionKey(): Buffer {
    const rawKey =
      this.configService.get<string>('app.auth.mfaEncryptionKey', { infer: true }) ?? '';

    return createHash('sha256').update(rawKey).digest();
  }

  private getPendingSetupKey(sessionId: string): string {
    const prefix =
      this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
    return `${prefix}:mfa_setup:${sessionId}`;
  }

  private getVerificationAttemptsKey(context: MfaThrottleContext): string {
    const prefix =
      this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
    return `${prefix}:mfa_verify:${context.scope}:${context.actorId}:attempts`;
  }

  private getVerificationLockKey(context: MfaThrottleContext): string {
    const prefix =
      this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
    return `${prefix}:mfa_verify:${context.scope}:${context.actorId}:lock`;
  }

  private async assertVerificationAllowed(context: MfaThrottleContext): Promise<void> {
    this.redisService.assertAvailable();
    const lockValue = await this.redisService.client.get(this.getVerificationLockKey(context));

    if (lockValue) {
      throw new HttpException(
        'Too many MFA verification attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerVerificationResult(
    context: MfaThrottleContext,
    success: boolean,
  ): Promise<void> {
    this.redisService.assertAvailable();

    const attemptsKey = this.getVerificationAttemptsKey(context);
    const lockKey = this.getVerificationLockKey(context);

    if (success) {
      await this.redisService.client.del(attemptsKey, lockKey);
      return;
    }

    const attempts = await this.redisService.client.incr(attemptsKey);
    if (attempts === 1) {
      await this.redisService.client.expire(attemptsKey, this.getVerifyWindowSeconds());
    }

    if (attempts < this.getVerifyMaxAttempts()) {
      return;
    }

    const lockoutSeconds = this.getVerifyLockoutSeconds();
    const lockedUntil = new Date(Date.now() + lockoutSeconds * 1000).toISOString();
    await this.redisService.client.set(lockKey, lockedUntil, 'EX', lockoutSeconds);
    await this.redisService.client.del(attemptsKey);
  }

  private getSetupTtlSeconds(): number {
    const minutes =
      this.configService.get<number>('app.auth.mfaSetupTtlMinutes', { infer: true }) ?? 10;
    return minutes * 60;
  }

  private getVerifyMaxAttempts(): number {
    return this.configService.get<number>('app.auth.mfaVerifyMaxAttempts', {
      infer: true,
    }) ?? 5;
  }

  private getVerifyWindowSeconds(): number {
    const minutes =
      this.configService.get<number>('app.auth.mfaVerifyWindowMinutes', {
        infer: true,
      }) ?? 10;
    return minutes * 60;
  }

  private getVerifyLockoutSeconds(): number {
    const minutes =
      this.configService.get<number>('app.auth.mfaVerifyLockoutMinutes', {
        infer: true,
      }) ?? 15;
    return minutes * 60;
  }
}

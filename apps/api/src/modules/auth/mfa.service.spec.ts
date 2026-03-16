import { HttpException, HttpStatus } from '@nestjs/common';
import { MfaService } from './mfa.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'SECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/demo'),
  verify: jest.fn(),
}));

describe('MfaService', () => {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();

  const redisClient = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      store.set(key, value);
      if (mode === 'EX' && typeof ttl === 'number') {
        expirations.set(key, ttl);
      }
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((key) => {
        store.delete(key);
        expirations.delete(key);
      });
      return keys.length;
    }),
    incr: jest.fn(async (key: string) => {
      const current = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(current));
      return current;
    }),
    expire: jest.fn(async (key: string, ttl: number) => {
      expirations.set(key, ttl);
      return 1;
    }),
  };

  const redisService = {
    assertAvailable: jest.fn(),
    client: redisClient,
  };

  const configService = {
    get: jest.fn((path: string) => {
      switch (path) {
        case 'app.name':
          return 'banking-platform-api';
        case 'app.auth.mfaEncryptionKey':
          return '12345678901234567890123456789012';
        case 'app.data.redisKeyPrefix':
          return 'platform';
        case 'app.auth.mfaSetupTtlMinutes':
          return 10;
        case 'app.auth.mfaVerifyMaxAttempts':
          return 2;
        case 'app.auth.mfaVerifyWindowMinutes':
          return 10;
        case 'app.auth.mfaVerifyLockoutMinutes':
          return 15;
        default:
          return undefined;
      }
    }),
  };

  let service: MfaService;
  let privateApi: {
    encryptSecret(secret: string): string;
    hashRecoveryCode(code: string): string;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    expirations.clear();
    service = new MfaService(configService as never, redisService as never);
    privateApi = service as unknown as {
      encryptSecret(secret: string): string;
      hashRecoveryCode(code: string): string;
    };
  });

  it('locks out TOTP verification after repeated failures', async () => {
    const encryptedSecret = await service.verifyPendingSetup('missing', '123456');
    expect(encryptedSecret).toBeNull();

    const payload = privateApi.encryptSecret('SECRET');
    const otplib = require('otplib') as { verify: jest.Mock };
    otplib.verify.mockResolvedValue({ valid: false });

    await expect(
      service.verifyEncryptedSecret(payload, '111111', {
        scope: 'totp',
        actorId: 'usr_1',
      }),
    ).resolves.toBe(false);

    await expect(
      service.verifyEncryptedSecret(payload, '222222', {
        scope: 'totp',
        actorId: 'usr_1',
      }),
    ).resolves.toBe(false);

    await expect(
      service.verifyEncryptedSecret(payload, '333333', {
        scope: 'totp',
        actorId: 'usr_1',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    } as Partial<HttpException>);
  });

  it('clears the throttle state after a successful recovery code', async () => {
    const hashes = [
      privateApi.hashRecoveryCode('AAAA-BBBB-CCCC-DDDD'),
    ];

    const failed = await service.consumeRecoveryCode(hashes, 'ZZZZ-1111-2222-3333', {
      scope: 'recovery',
      actorId: 'usr_1',
    });
    expect(failed.matched).toBe(false);

    const success = await service.consumeRecoveryCode(hashes, 'AAAA-BBBB-CCCC-DDDD', {
      scope: 'recovery',
      actorId: 'usr_1',
    });
    expect(success.matched).toBe(true);
    expect(store.has('platform:mfa_verify:recovery:usr_1:attempts')).toBe(false);
    expect(store.has('platform:mfa_verify:recovery:usr_1:lock')).toBe(false);
  });
});

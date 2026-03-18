import { HttpStatus } from '@nestjs/common';
import { AuthRateLimitService } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  const store = new Map<string, { value: string; expireSeconds?: number }>();

  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'app.data.redisKeyPrefix') {
        return 'platform';
      }

      if (path === 'app.auth.rateLimitWindowMinutes') {
        return 10;
      }

      if (path === 'app.auth.loginRateLimitMaxAttempts') {
        return 2;
      }

      if (path === 'app.auth.reauthRateLimitMaxAttempts') {
        return 1;
      }

      return undefined;
    }),
  };

  const redisService = {
    ensureAvailable: jest.fn(async () => undefined),
    client: {
      get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
      incr: jest.fn(async (key: string) => {
        const current = Number(store.get(key)?.value ?? '0') + 1;
        const previous = store.get(key);
        store.set(key, {
          value: String(current),
          expireSeconds: previous?.expireSeconds,
        });
        return current;
      }),
      expire: jest.fn(async (key: string, seconds: number) => {
        const current = store.get(key);
        if (current) {
          store.set(key, {
            ...current,
            expireSeconds: seconds,
          });
        }

        return 1;
      }),
      del: jest.fn(async (...keys: string[]) => {
        for (const key of keys) {
          store.delete(key);
        }

        return keys.length;
      }),
    },
  };

  let service: AuthRateLimitService;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    service = new AuthRateLimitService(configService as never, redisService as never);
  });

  it('tracks login failures by normalized email and ip address', async () => {
    await service.registerLoginFailure('ADMIN@example.com', '127.0.0.1');

    expect(store.get('platform:auth_rate_limit:login:email:admin@example.com')?.value).toBe('1');
    expect(store.get('platform:auth_rate_limit:login:ip:127.0.0.1')?.value).toBe('1');
    expect(store.get('platform:auth_rate_limit:login:email:admin@example.com')?.expireSeconds).toBe(
      600,
    );
  });

  it('blocks login attempts when the configured threshold is reached', async () => {
    await service.registerLoginFailure('admin@example.com', '127.0.0.1');
    await service.registerLoginFailure('admin@example.com', '127.0.0.1');

    await expect(
      service.assertLoginAllowed('admin@example.com', '127.0.0.1'),
    ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
  });

  it('clears login failures after a successful authentication', async () => {
    await service.registerLoginFailure('admin@example.com', '127.0.0.1');

    await service.clearLoginFailures('admin@example.com', '127.0.0.1');

    expect(store.size).toBe(0);
  });

  it('blocks reauthentication attempts per user when the threshold is reached', async () => {
    await service.registerReauthenticationFailure('usr_1', '127.0.0.1');

    await expect(
      service.assertReauthenticationAllowed('usr_1', '127.0.0.1'),
    ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
  });
});

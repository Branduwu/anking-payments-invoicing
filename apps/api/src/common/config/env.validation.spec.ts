import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const baseEnv = {
    NODE_ENV: 'development',
    APP_NAME: 'banking-platform-api',
    PORT: '4000',
    API_PREFIX: 'api',
    CORS_ORIGIN: 'http://localhost:3000',
    COOKIE_SECRET: '12345678901234567890123456789012',
    SESSION_IDLE_TIMEOUT_MINUTES: '15',
    SESSION_ABSOLUTE_TIMEOUT_HOURS: '8',
    REAUTH_WINDOW_MINUTES: '5',
    AUTH_MAX_FAILED_ATTEMPTS: '5',
    AUTH_LOCKOUT_MINUTES: '15',
    AUTH_RATE_LIMIT_WINDOW_MINUTES: '10',
    AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '10',
    AUTH_REAUTH_RATE_LIMIT_MAX_ATTEMPTS: '5',
    MFA_SETUP_TTL_MINUTES: '10',
    MFA_VERIFY_MAX_ATTEMPTS: '5',
    MFA_VERIFY_WINDOW_MINUTES: '10',
    MFA_VERIFY_LOCKOUT_MINUTES: '15',
    MFA_ENCRYPTION_KEY: '12345678901234567890123456789012',
    DATABASE_URL: 'postgresql://platform:platform@localhost:5432/platform',
    REDIS_URL: 'redis://localhost:6379',
    PAC_PROVIDER: 'mock',
    PAC_TIMEOUT_MS: '10000',
    HTTP_SLOW_REQUEST_THRESHOLD_MS: '1000',
  };

  it('defaults to a non-prefixed cookie name when secure cookies are not enabled', () => {
    const parsed = validateEnv(baseEnv);

    expect(parsed.COOKIE_NAME).toBe('session');
  });

  it('rejects __Host- cookie names when COOKIE_SECURE is false', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        COOKIE_NAME: '__Host-session',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow('COOKIE_NAME con prefijo __Host- requiere COOKIE_SECURE=true');
  });

  it('allows __Host- cookie names when COOKIE_SECURE is true', () => {
    const parsed = validateEnv({
      ...baseEnv,
      COOKIE_NAME: '__Host-session',
      COOKIE_SECURE: 'true',
    });

    expect(parsed.COOKIE_NAME).toBe('__Host-session');
  });
});

import { registerAs } from '@nestjs/config';

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export default registerAs('app', () => ({
  name: process.env.APP_NAME ?? 'banking-platform-api',
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookie: {
    name: process.env.COOKIE_NAME ?? '__Host-session',
    secret: process.env.COOKIE_SECRET ?? '',
    secure: parseBoolean(
      process.env.COOKIE_SECURE,
      (process.env.NODE_ENV ?? 'development') === 'production',
    ),
    sameSite: 'strict' as const,
    httpOnly: true,
    path: '/',
  },
  session: {
    idleTimeoutMinutes: Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 15),
    absoluteTimeoutHours: Number(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 8),
    reauthWindowMinutes: Number(process.env.REAUTH_WINDOW_MINUTES ?? 5),
  },
  auth: {
    maxFailedAttempts: Number(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15),
    mfaSetupTtlMinutes: Number(process.env.MFA_SETUP_TTL_MINUTES ?? 10),
    mfaVerifyMaxAttempts: Number(process.env.MFA_VERIFY_MAX_ATTEMPTS ?? 5),
    mfaVerifyWindowMinutes: Number(process.env.MFA_VERIFY_WINDOW_MINUTES ?? 10),
    mfaVerifyLockoutMinutes: Number(process.env.MFA_VERIFY_LOCKOUT_MINUTES ?? 15),
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY ?? '',
  },
  audit: {
    failClosedDefault: parseBoolean(process.env.AUDIT_FAIL_CLOSED_DEFAULT, false),
    failClosedActionPrefixes: parseList(process.env.AUDIT_FAIL_CLOSED_ACTION_PREFIXES, [
      'sessions.',
      'payments.create.success',
      'invoices.create.success',
      'invoices.stamp.success',
      'invoices.cancel.success',
      'auth.mfa.setup.created',
      'auth.mfa.verify.success',
      'auth.mfa.recovery_codes.regenerated',
      'auth.mfa.disabled',
      'auth.mfa.admin_reset.success',
    ]),
  },
  data: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? '',
    redisKeyPrefix: process.env.REDIS_KEY_PREFIX ?? 'platform',
  },
  integrations: {
    pac: {
      provider: process.env.PAC_PROVIDER ?? 'mock',
      baseUrl: process.env.PAC_BASE_URL ?? '',
      apiKey: process.env.PAC_API_KEY ?? '',
      timeoutMs: Number(process.env.PAC_TIMEOUT_MS ?? 10_000),
      allowMockInProduction: parseBoolean(process.env.PAC_ALLOW_MOCK_IN_PRODUCTION, false),
    },
  },
  runtime: {
    allowDegradedStartup: parseBoolean(process.env.ALLOW_DEGRADED_STARTUP, false),
  },
}));

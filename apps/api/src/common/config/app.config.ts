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

const resolveCookieSecure = (): boolean =>
  parseBoolean(process.env.COOKIE_SECURE, (process.env.NODE_ENV ?? 'development') === 'production');

const resolveDefaultCookieName = (secure: boolean): string => (secure ? '__Host-session' : 'session');

export default registerAs('app', () => {
  const cookieSecure = resolveCookieSecure();
  const cookieName = process.env.COOKIE_NAME ?? resolveDefaultCookieName(cookieSecure);

  return {
  name: process.env.APP_NAME ?? 'banking-platform-api',
  version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
  commitSha: process.env.APP_COMMIT_SHA ?? 'local',
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookie: {
    name: cookieName,
    secret: process.env.COOKIE_SECRET ?? '',
    secure: cookieSecure,
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
    rateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES ?? 10),
    loginRateLimitMaxAttempts: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS ?? 10),
    reauthRateLimitMaxAttempts: Number(process.env.AUTH_REAUTH_RATE_LIMIT_MAX_ATTEMPTS ?? 5),
    mfaSetupTtlMinutes: Number(process.env.MFA_SETUP_TTL_MINUTES ?? 10),
    mfaVerifyMaxAttempts: Number(process.env.MFA_VERIFY_MAX_ATTEMPTS ?? 5),
    mfaVerifyWindowMinutes: Number(process.env.MFA_VERIFY_WINDOW_MINUTES ?? 10),
    mfaVerifyLockoutMinutes: Number(process.env.MFA_VERIFY_LOCKOUT_MINUTES ?? 15),
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY ?? '',
  },
  audit: {
    failClosedDefault: parseBoolean(process.env.AUDIT_FAIL_CLOSED_DEFAULT, false),
    failClosedSuccessActionPrefixes: parseList(
      process.env.AUDIT_FAIL_CLOSED_SUCCESS_ACTION_PREFIXES,
      [
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
      ],
    ),
    failClosedFailureActionPrefixes: parseList(
      process.env.AUDIT_FAIL_CLOSED_FAILURE_ACTION_PREFIXES,
      [
        'auth.login.failure',
        'auth.login.denied',
        'auth.reauthenticate.failure',
        'auth.reauthenticate.denied',
        'auth.mfa.verify.failure',
      ],
    ),
    failClosedDeniedActionPrefixes: parseList(
      process.env.AUDIT_FAIL_CLOSED_DENIED_ACTION_PREFIXES,
      [
        'auth.',
        'payments.create.denied',
        'invoices.create.denied',
        'invoices.stamp.denied',
        'invoices.cancel.denied',
      ],
    ),
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
    directDatabaseUrl: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
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
  observability: {
    slowRequestThresholdMs: Number(process.env.HTTP_SLOW_REQUEST_THRESHOLD_MS ?? 1_000),
  },
  runtime: {
    allowDegradedStartup: parseBoolean(process.env.ALLOW_DEGRADED_STARTUP, false),
  },
  };
});

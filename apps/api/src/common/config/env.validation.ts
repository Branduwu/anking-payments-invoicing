import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(1).default('banking-platform-api'),
    APP_VERSION: z.string().min(1).optional(),
    APP_COMMIT_SHA: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().min(1).default('api'),
    CORS_ORIGIN: z
      .string()
      .min(1)
      .default('http://localhost:3000,http://127.0.0.1:3000'),
    COOKIE_NAME: z.string().min(1).default('session'),
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET debe tener al menos 32 caracteres'),
    COOKIE_SECURE: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .optional(),
    CSRF_TRUSTED_ORIGINS: z.string().optional(),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(8),
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
    SESSION_TOUCH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
    AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    AUTH_REAUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    MFA_SETUP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    MFA_VERIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    MFA_VERIFY_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
    MFA_VERIFY_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY debe tener al menos 32 caracteres'),
    WEBAUTHN_RP_NAME: z.string().min(1).default('banking-platform-api'),
    WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
    WEBAUTHN_ORIGINS: z
      .string()
      .min(1)
      .default(
        'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000',
      ),
    WEBAUTHN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    DATABASE_URL: z
      .string()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'DATABASE_URL debe usar el esquema postgresql:// o postgres://',
      }),
    DIRECT_DATABASE_URL: z
      .string()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'DIRECT_DATABASE_URL debe usar el esquema postgresql:// o postgres://',
      }),
    REDIS_URL: z
      .string()
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'REDIS_URL debe usar el esquema redis:// o rediss://',
      }),
    REDIS_KEY_PREFIX: z.string().min(1).default('platform'),
    PAC_PROVIDER: z.enum(['mock', 'custom-http']).default('mock'),
    PAC_BASE_URL: z.string().optional(),
    PAC_API_KEY: z.string().optional(),
    PAC_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    PAC_ALLOW_MOCK_IN_PRODUCTION: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .optional(),
    AUDIT_FAIL_CLOSED_DEFAULT: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .optional(),
    AUDIT_FAIL_CLOSED_SUCCESS_ACTION_PREFIXES: z.string().optional(),
    AUDIT_FAIL_CLOSED_FAILURE_ACTION_PREFIXES: z.string().optional(),
    AUDIT_FAIL_CLOSED_DENIED_ACTION_PREFIXES: z.string().optional(),
    AUDIT_FAIL_CLOSED_ACTION_PREFIXES: z.string().optional(),
    HTTP_SLOW_REQUEST_THRESHOLD_MS: z.coerce.number().int().positive().default(1000),
    METRICS_BEARER_TOKEN: z.string().min(16).optional(),
    ALLOW_DEGRADED_STARTUP: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .optional(),
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(12).optional(),
    ADMIN_NAME: z.string().min(1).optional(),
    ADMIN_MFA_TOTP_CODE: z.string().optional(),
    ADMIN_MFA_RECOVERY_CODE: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    const cookieSecure =
      config.COOKIE_SECURE === undefined
        ? config.NODE_ENV === 'production'
        : ['true', '1', 'yes', 'on'].includes(config.COOKIE_SECURE.toLowerCase());

    if (config.COOKIE_NAME.startsWith('__Host-') && !cookieSecure) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_NAME'],
        message: 'COOKIE_NAME con prefijo __Host- requiere COOKIE_SECURE=true',
      });
    }

    if (config.COOKIE_NAME.startsWith('__Secure-') && !cookieSecure) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_NAME'],
        message: 'COOKIE_NAME con prefijo __Secure- requiere COOKIE_SECURE=true',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>): AppEnv => envSchema.parse(config);

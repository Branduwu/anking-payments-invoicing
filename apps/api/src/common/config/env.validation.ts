import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('banking-platform-api'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().min(1).default('api'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  COOKIE_NAME: z.string().min(1).default('__Host-session'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET debe tener al menos 32 caracteres'),
  COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .optional(),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(8),
  REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  MFA_SETUP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  MFA_VERIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  MFA_VERIFY_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
  MFA_VERIFY_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY debe tener al menos 32 caracteres'),
  DATABASE_URL: z
    .string()
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
      message: 'DATABASE_URL debe usar el esquema postgresql:// o postgres://',
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
  AUDIT_FAIL_CLOSED_ACTION_PREFIXES: z.string().optional(),
  ALLOW_DEGRADED_STARTUP: z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  ADMIN_NAME: z.string().min(1).optional(),
  ADMIN_MFA_TOTP_CODE: z.string().optional(),
  ADMIN_MFA_RECOVERY_CODE: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>): AppEnv => envSchema.parse(config);

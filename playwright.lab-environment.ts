const defaultDatabaseUrl = 'postgresql://platform:platform@localhost:5432/platform';
const defaultRedisUrl = 'redis://localhost:6379';
const resolveLabHost = (): 'localhost' | '127.0.0.1' => {
  const configured = process.env.WEBAUTHN_LAB_HOST?.trim();
  return configured === '127.0.0.1' ? '127.0.0.1' : 'localhost';
};

const labHost = resolveLabHost();
const alternateLabHost = labHost === 'localhost' ? '127.0.0.1' : 'localhost';
const labApiPort = '4100';
const labWebPort = '3100';
const labApiOrigin = `http://${labHost}:${labApiPort}`;
const labWebOrigin = `http://${labHost}:${labWebPort}`;
const alternateLabWebOrigin = `http://${alternateLabHost}:${labWebPort}`;
const allowedLabWebOrigins = [labWebOrigin, alternateLabWebOrigin].join(',');

export const webauthnLabDemoEmail =
  process.env.WEBAUTHN_DEMO_EMAIL ?? 'webauthn.demo@example.com';
export const webauthnLabDemoPassword =
  process.env.WEBAUTHN_DEMO_PASSWORD ?? 'ChangeMeNow_123456789!';
export const webauthnLabApiBaseUrl = `${labApiOrigin}/api`;
export const webauthnLabWebBaseUrl = labWebOrigin;
export const webauthnLabAlternateWebBaseUrl = alternateLabWebOrigin;

export const webauthnLabEnvironment = {
  ...process.env,
  PORT: labApiPort,
  DATABASE_URL: process.env.WEBAUTHN_LAB_DATABASE_URL ?? defaultDatabaseUrl,
  DIRECT_DATABASE_URL: process.env.WEBAUTHN_LAB_DATABASE_URL ?? defaultDatabaseUrl,
  REDIS_URL: process.env.WEBAUTHN_LAB_REDIS_URL ?? defaultRedisUrl,
  CORS_ORIGIN: allowedLabWebOrigins,
  CSRF_TRUSTED_ORIGINS: allowedLabWebOrigins,
  WEBAUTHN_RP_ID: labHost,
  WEBAUTHN_ORIGINS: allowedLabWebOrigins,
  WEBAUTHN_DEMO_EMAIL: webauthnLabDemoEmail,
  WEBAUTHN_DEMO_PASSWORD: webauthnLabDemoPassword,
} as Record<string, string>;

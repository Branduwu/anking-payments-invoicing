const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRUSTED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

export interface CsrfProtectionRequestLike {
  method?: string;
  url?: string;
  cookies?: Record<string, string | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

export interface CsrfProtectionConfig {
  apiPrefix: string;
  cookieName: string;
  trustedOrigins: string[];
}

export interface CsrfProtectionDecision {
  allowed: boolean;
  reason?:
    | 'safe-method'
    | 'no-cookie-backed-mutation'
    | 'trusted-origin'
    | 'trusted-referer'
    | 'non-browser-client'
    | 'cross-site-fetch-site'
    | 'untrusted-origin'
    | 'untrusted-referer';
  detail?: string;
}

export const evaluateCsrfProtection = (
  request: CsrfProtectionRequestLike,
  config: CsrfProtectionConfig,
): CsrfProtectionDecision => {
  const method = (request.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return { allowed: true, reason: 'safe-method' };
  }

  if (!requiresCookieBackedMutationProtection(request, config)) {
    return { allowed: true, reason: 'no-cookie-backed-mutation' };
  }

  const trustedOrigins = normalizeOrigins(config.trustedOrigins);
  const origin = normalizeHeaderValue(request.headers.origin);
  if (origin) {
    return trustedOrigins.has(origin)
      ? { allowed: true, reason: 'trusted-origin' }
      : { allowed: false, reason: 'untrusted-origin', detail: origin };
  }

  const referer = normalizeHeaderValue(request.headers.referer);
  const refererOrigin = extractOrigin(referer);
  if (refererOrigin) {
    return trustedOrigins.has(refererOrigin)
      ? { allowed: true, reason: 'trusted-referer' }
      : { allowed: false, reason: 'untrusted-referer', detail: refererOrigin };
  }

  const fetchSite = normalizeHeaderValue(request.headers['sec-fetch-site']);
  if (fetchSite && !TRUSTED_FETCH_SITES.has(fetchSite)) {
    return {
      allowed: false,
      reason: 'cross-site-fetch-site',
      detail: fetchSite,
    };
  }

  return { allowed: true, reason: 'non-browser-client' };
};

const requiresCookieBackedMutationProtection = (
  request: CsrfProtectionRequestLike,
  config: CsrfProtectionConfig,
): boolean => {
  const hasSessionCookie = Boolean(request.cookies?.[config.cookieName]);
  if (hasSessionCookie) {
    return true;
  }

  const requestPath = normalizeRequestPath(request.url);
  const authMutationPrefix = getAuthMutationPrefix(config.apiPrefix);

  return requestPath === authMutationPrefix || requestPath.startsWith(`${authMutationPrefix}/`);
};

const normalizeOrigins = (origins: string[]): Set<string> =>
  new Set(
    origins
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin)),
  );

const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const extractOrigin = (value: string | undefined): string | null => {
  return normalizeOrigin(value);
};

const normalizeRequestPath = (value: string | undefined): string => {
  if (!value) {
    return '/';
  }

  try {
    const parsed = new URL(value, 'http://localhost');
    const pathname = parsed.pathname.trim();
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  } catch {
    const pathname = value.split('?')[0]?.trim() || '/';
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  }
};

const getAuthMutationPrefix = (apiPrefix: string): string => {
  const normalizedPrefix = apiPrefix.trim().replace(/^\/+|\/+$/g, '');
  return normalizedPrefix.length > 0 ? `/${normalizedPrefix}/auth` : '/auth';
};

const normalizeHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  return undefined;
};

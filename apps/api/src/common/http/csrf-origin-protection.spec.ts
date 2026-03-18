import { evaluateCsrfProtection } from './csrf-origin-protection';

describe('evaluateCsrfProtection', () => {
  const config = {
    apiPrefix: 'api',
    cookieName: 'session',
    trustedOrigins: ['http://localhost:3000', 'http://localhost:4000'],
  };

  it('allows safe methods without further checks', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'GET',
        url: '/api/health/live',
        headers: {},
      },
      config,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('safe-method');
  });

  it('rejects cookie-backed mutations from an untrusted origin', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'POST',
        url: '/api/customers',
        cookies: { session: 'sess_1' },
        headers: {
          origin: 'https://evil.example',
        },
      },
      config,
    );

    expect(decision).toEqual({
      allowed: false,
      reason: 'untrusted-origin',
      detail: 'https://evil.example',
    });
  });

  it('rejects cross-site browser requests even when origin is absent', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'sec-fetch-site': 'cross-site',
        },
      },
      config,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('cross-site-fetch-site');
  });

  it('uses the configured API prefix instead of a hardcoded /api path', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'POST',
        url: '/platform/auth/login?redirect=%2Fdashboard',
        headers: {
          'sec-fetch-site': 'cross-site',
        },
      },
      {
        ...config,
        apiPrefix: 'platform',
      },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('cross-site-fetch-site');
  });

  it('normalizes trailing slashes before matching auth mutations', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'POST',
        url: '/api/auth/logout/',
        headers: {
          origin: 'https://evil.example',
        },
      },
      config,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('untrusted-origin');
  });

  it('allows trusted referers for cookie-backed mutations', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'DELETE',
        url: '/api/sessions/all',
        cookies: { session: 'sess_1' },
        headers: {
          referer: 'http://localhost:3000/account/security',
        },
      },
      config,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('trusted-referer');
  });

  it('allows non-browser clients without origin metadata', () => {
    const decision = evaluateCsrfProtection(
      {
        method: 'POST',
        url: '/api/auth/login',
        headers: {},
      },
      config,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('non-browser-client');
  });
});

import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';

describe('SessionAuthGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const configService = {
    get: jest.fn(() => '__Host-session'),
  };

  const sessionsService = {
    validateSession: jest.fn(),
  };

  let guard: SessionAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new SessionAuthGuard(
      reflector as never,
      configService as never,
      sessionsService as never,
    );
  });

  it('allows an authenticated session without pending MFA', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    sessionsService.validateSession.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      status: 'active',
      mfaLevel: 'none',
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
    });

    const request = {
      cookies: {
        '__Host-session': 'sess_1',
      },
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({
      session: expect.objectContaining({ id: 'sess_1' }),
      user: { id: 'usr_1' },
    });
  });

  it('rejects access when the session still requires MFA', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    sessionsService.validateSession.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      status: 'active',
      mfaLevel: 'none',
      requiresMfa: true,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
    });

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: {
            '__Host-session': 'sess_1',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows explicit pending-MFA routes such as MFA verification', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    sessionsService.validateSession.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      status: 'active',
      mfaLevel: 'none',
      requiresMfa: true,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
    });

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: {
            '__Host-session': 'sess_1',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

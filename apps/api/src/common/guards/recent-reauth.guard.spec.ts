import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { RecentReauthGuard } from './recent-reauth.guard';

describe('RecentReauthGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const auditService = {
    record: jest.fn(),
  };

  let guard: RecentReauthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RecentReauthGuard(reflector as never, auditService as never);
  });

  it('allows requests that do not require recent reauthentication', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          session: {},
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('audits and rejects when reauthentication is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'req_1',
          ip: '127.0.0.1',
          method: 'POST',
          url: '/api/payments',
          session: {
            id: 'sess_1',
            userId: 'usr_1',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.denied',
        result: 'DENIED',
        userId: 'usr_1',
        entityId: 'sess_1',
        metadata: expect.objectContaining({
          reason: 'recent-reauth-missing',
        }),
      }),
    );
  });

  it('audits and rejects when reauthentication is expired', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'req_2',
          ip: '127.0.0.1',
          method: 'PATCH',
          url: '/api/customers/customer_1',
          session: {
            id: 'sess_1',
            userId: 'usr_1',
            reauthenticatedUntil: new Date(Date.now() - 1_000),
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.denied',
        result: 'DENIED',
        metadata: expect.objectContaining({
          reason: 'recent-reauth-expired',
        }),
      }),
    );
  });
});

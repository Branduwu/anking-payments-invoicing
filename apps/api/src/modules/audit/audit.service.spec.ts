import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const prismaService = {
    isAvailable: jest.fn(),
    auditEvent: {
      create: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'app.audit.failClosedDefault') {
        return false;
      }

      if (path === 'app.audit.failClosedSuccessActionPrefixes') {
        return ['payments.create.success', 'auth.mfa.verify.success'];
      }

      if (path === 'app.audit.failClosedFailureActionPrefixes') {
        return ['auth.login.failure'];
      }

      if (path === 'app.audit.failClosedDeniedActionPrefixes') {
        return ['payments.create.denied', 'auth.mfa.admin_reset.denied'];
      }

      if (path === 'app.audit.failClosedActionPrefixes') {
        return ['payments.create.success', 'auth.mfa.verify.success'];
      }

      return undefined;
    }),
  };

  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prismaService.isAvailable.mockReturnValue(false);
    service = new AuditService(prismaService as never, configService as never);
  });

  it('fails closed by default for configured critical success actions', async () => {
    await expect(
      service.record({
        action: 'payments.create.success',
        result: 'SUCCESS',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps best-effort behavior for non-critical audit events', async () => {
    await expect(
      service.record({
        action: 'payments.list.denied',
        result: 'DENIED',
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed for configured failure actions', async () => {
    await expect(
      service.record({
        action: 'auth.login.failure',
        result: 'FAILURE',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed for configured denied actions', async () => {
    await expect(
      service.record({
        action: 'payments.create.denied',
        result: 'DENIED',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('honors an explicit failClosed override', async () => {
    await expect(
      service.record(
        {
          action: 'payments.list.denied',
          result: 'DENIED',
        },
        {
          failClosed: true,
        },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

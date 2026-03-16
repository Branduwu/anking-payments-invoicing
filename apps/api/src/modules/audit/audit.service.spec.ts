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

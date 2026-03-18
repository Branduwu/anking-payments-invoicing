import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  const configService = {
    get: jest.fn((path: string) => {
      switch (path) {
        case 'app.session.idleTimeoutMinutes':
          return 15;
        case 'app.session.absoluteTimeoutHours':
          return 8;
        case 'app.session.reauthWindowMinutes':
          return 5;
        case 'app.session.touchIntervalSeconds':
          return 60;
        default:
          return undefined;
      }
    }),
  };

  const redisService = {
    ensureAvailable: jest.fn(async () => undefined),
  };

  const auditService = {
    record: jest.fn(),
  };

  let service: SessionsService;
  let privateApi: {
    getSession(sessionId: string): Promise<unknown>;
    persistSession(session: unknown): Promise<void>;
    deleteSession(userId: string, sessionId: string): Promise<void>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionsService(
      configService as never,
      redisService as never,
      auditService as never,
    );
    privateApi = service as unknown as {
      getSession(sessionId: string): Promise<unknown>;
      persistSession(session: unknown): Promise<void>;
      deleteSession(userId: string, sessionId: string): Promise<void>;
    };
  });

  it('creates the replacement session before revoking the current session', async () => {
    const currentSession = {
      id: 'sess_current',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'totp' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    };
    const nextSession = {
      id: 'sess_next',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'totp' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:01:00.000Z'),
      lastActivity: new Date('2026-03-16T00:01:00.000Z'),
      expiresAt: new Date('2026-03-16T00:16:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:01:00.000Z'),
    };

    const validateSpy = jest.spyOn(service, 'validateSession').mockResolvedValue(currentSession);
    const createSpy = jest.spyOn(service, 'createSession').mockResolvedValue(nextSession);
    const revokeSpy = jest.spyOn(service, 'revokeSession').mockResolvedValue(true);
    const persistSpy = jest
      .spyOn(privateApi, 'persistSession')
      .mockImplementation(async () => undefined);

    const result = await service.rotateSession('sess_current', {
      requestId: 'req_1',
      ipAddress: '127.0.0.1',
    });

    expect(validateSpy).toHaveBeenCalledWith('sess_current');
    expect(createSpy.mock.invocationCallOrder[0]).toBeLessThan(revokeSpy.mock.invocationCallOrder[0]);
    expect(revokeSpy).toHaveBeenCalledWith('usr_1', 'sess_current', 'session-rotation');
    expect(persistSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sess_next',
        reauthenticatedUntil: currentSession.reauthenticatedUntil,
      }),
    );
    expect(result.reauthenticatedUntil).toEqual(currentSession.reauthenticatedUntil);
  });

  it('removes the replacement session if revoking the previous session fails', async () => {
    const currentSession = {
      id: 'sess_current',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'totp' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
    };
    const nextSession = {
      id: 'sess_next',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'totp' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:01:00.000Z'),
      lastActivity: new Date('2026-03-16T00:01:00.000Z'),
      expiresAt: new Date('2026-03-16T00:16:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:01:00.000Z'),
    };

    jest.spyOn(service, 'validateSession').mockResolvedValue(currentSession);
    jest.spyOn(service, 'createSession').mockResolvedValue(nextSession);
    jest
      .spyOn(service, 'revokeSession')
      .mockRejectedValue(new Error('audit persistence unavailable'));
    const deleteSpy = jest
      .spyOn(privateApi, 'deleteSession')
      .mockImplementation(async () => undefined);

    await expect(
      service.rotateSession('sess_current', {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toThrow('audit persistence unavailable');

    expect(deleteSpy).toHaveBeenCalledWith('usr_1', 'sess_next');
  });

  it('touches the session when the configured touch window has elapsed', async () => {
    const session = {
      id: 'sess_current',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'none' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date(Date.now() - 90_000),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 60 * 60_000),
    };

    jest.spyOn(privateApi, 'getSession').mockResolvedValue(session);
    const persistSpy = jest
      .spyOn(privateApi, 'persistSession')
      .mockImplementation(async () => undefined);

    const result = await service.validateSession('sess_current');

    expect(redisService.ensureAvailable).toHaveBeenCalled();
    expect(persistSpy).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'sess_current' }));
  });

  it('avoids rewriting Redis on every request when the touch window has not elapsed', async () => {
    const session = {
      id: 'sess_current',
      userId: 'usr_1',
      status: 'active' as const,
      mfaLevel: 'none' as const,
      requiresMfa: false,
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date(Date.now() - 15_000),
      expiresAt: new Date(Date.now() + 10 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 60 * 60_000),
    };

    jest.spyOn(privateApi, 'getSession').mockResolvedValue(session);
    const persistSpy = jest
      .spyOn(privateApi, 'persistSession')
      .mockImplementation(async () => undefined);

    await service.validateSession('sess_current');

    expect(redisService.ensureAvailable).toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });
});

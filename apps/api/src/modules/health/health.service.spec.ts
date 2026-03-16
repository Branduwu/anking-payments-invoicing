import { HealthService } from './health.service';

describe('HealthService', () => {
  const configService = {
    get: jest.fn((path: string) => {
      switch (path) {
        case 'app.name':
          return 'banking-platform-api';
        case 'app.version':
          return '0.1.0-test';
        case 'app.commitSha':
          return 'abcdef1';
        case 'app.env':
          return 'test';
        case 'app.runtime.allowDegradedStartup':
          return true;
        default:
          return undefined;
      }
    }),
  };

  const prismaService = {
    isAvailable: jest.fn(),
    markAvailable: jest.fn(),
    markUnavailable: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const redisService = {
    isAvailable: jest.fn(),
    markAvailable: jest.fn(),
    markUnavailable: jest.fn(),
    ping: jest.fn(),
  };

  let service: HealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthService(
      configService as never,
      prismaService as never,
      redisService as never,
    );
  });

  it('returns liveness metadata', () => {
    const payload = service.getLiveness();

    expect(payload.status).toBe('ok');
    expect(payload.service.name).toBe('banking-platform-api');
    expect(payload.service.version).toBe('0.1.0-test');
    expect(payload.service.commitSha).toBe('abcdef1');
    expect(payload.service.environment).toBe('test');
    expect(payload.service.degradedStartupAllowed).toBe(true);
  });

  it('returns ready when dependencies respond', async () => {
    prismaService.isAvailable.mockReturnValue(true);
    prismaService.$queryRaw.mockResolvedValue(undefined);
    redisService.isAvailable.mockReturnValue(true);
    redisService.ping.mockResolvedValue('PONG');

    const payload = await service.getReadiness();

    expect(payload.status).toBe('ready');
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'postgresql',
          status: 'up',
        }),
        expect.objectContaining({
          name: 'redis',
          status: 'up',
        }),
      ]),
    );
  });

  it('returns degraded when dependencies are unavailable', async () => {
    prismaService.isAvailable.mockReturnValue(false);
    redisService.isAvailable.mockReturnValue(false);

    const payload = await service.getReadiness();

    expect(payload.status).toBe('degraded');
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'postgresql',
          status: 'down',
        }),
        expect.objectContaining({
          name: 'redis',
          status: 'down',
        }),
      ]),
    );
  });
});

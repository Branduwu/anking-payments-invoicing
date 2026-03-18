import { Logger, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  let loggerSpy: jest.SpyInstance;

  const createHost = () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const request = {
      id: 'req_1',
      url: '/api/auth/login',
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as ArgumentsHost;

    return {
      host,
      response,
    };
  };

  beforeEach(() => {
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('maps dependency connection errors carried through causes to 503', () => {
    const { host, response } = createHost();
    const exception = new Error('wrapper error', {
      cause: Object.assign(new Error('socket failure'), { code: 'ECONNREFUSED' }),
    });

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'A required dependency is unavailable',
      }),
    );
  });

  it('maps known dependency unavailability messages to 503 without regex matching', () => {
    const { host, response } = createHost();

    filter.catch(new Error('Connection is closed.'), host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'A required dependency is unavailable',
      }),
    );
  });

  it('keeps unexpected errors as 500', () => {
    const { host, response } = createHost();

    filter.catch(new Error('unexpected failure'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

describe('RequestLoggingInterceptor', () => {
  const configService = {
    get: jest.fn(() => 1_000),
  };

  const request = {
    id: 'req-123',
    method: 'GET',
    url: '/api/health/ready',
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'jest',
    },
    user: undefined,
  };

  const response = {
    statusCode: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs controlled 503 responses as warnings instead of 500 errors', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const interceptor = new RequestLoggingInterceptor(configService as never);
    const exception = new ServiceUnavailableException('Dependencies are not ready');
    const privateApi = interceptor as unknown as {
      resolveErrorStatusCode(
        error: unknown,
        reply: {
          statusCode: number;
        },
      ): number;
      logRequest(params: {
        request: typeof request;
        statusCode: number;
        durationMs: number;
        error?: unknown;
      }): void;
    };

    const statusCode = privateApi.resolveErrorStatusCode(exception, response);
    privateApi.logRequest({
      request,
      statusCode,
      durationMs: 1,
      error: exception,
    });

    expect(statusCode).toBe(503);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"statusCode":503'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs successful requests as info', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new RequestLoggingInterceptor(configService as never);
    const privateApi = interceptor as unknown as {
      logRequest(params: {
        request: typeof request;
        statusCode: number;
        durationMs: number;
        error?: unknown;
      }): void;
    };

    privateApi.logRequest({
      request,
      statusCode: 200,
      durationMs: 10,
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"statusCode":200'));
  });
});

import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

describe('ObservabilityService', () => {
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
        case 'app.observability.slowRequestThresholdMs':
          return 500;
        default:
          return undefined;
      }
    }),
  };

  let service: ObservabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ObservabilityService(configService as unknown as ConfigService);
  });

  it('renders request and dependency metrics in Prometheus format', () => {
    service.recordHttpRequest({
      method: 'GET',
      path: '/api/customers/123?source=ui',
      statusCode: 200,
      durationMs: 640,
    });
    service.recordDependencyCheck({
      name: 'postgresql',
      status: 'up',
      latencyMs: 12,
    });

    const metrics = service.renderMetrics();

    expect(metrics).toContain('banking_platform_build_info');
    expect(metrics).toContain(
      'banking_platform_http_requests_total{method="GET",path="/api/customers/:id",status_code="200"} 1',
    );
    expect(metrics).toContain(
      'banking_platform_http_slow_requests_total{method="GET",path="/api/customers/:id"} 1',
    );
    expect(metrics).toContain('banking_platform_dependency_up{name="postgresql"} 1');
    expect(metrics).toContain(
      'banking_platform_dependency_check_latency_ms{name="postgresql"} 12',
    );
  });

  it('does not count scrapes of the metrics endpoint itself', () => {
    service.recordHttpRequest({
      method: 'GET',
      path: '/api/metrics',
      statusCode: 200,
      durationMs: 5,
    });

    const metrics = service.renderMetrics();

    expect(metrics).not.toContain('path="/api/metrics"');
  });
});

describe('ObservabilityController', () => {
  const observabilityService = {
    renderMetrics: jest.fn(() => 'banking_platform_build_info 1\n'),
  };

  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'app.observability.metricsBearerToken') {
        return 'metrics-secret-token';
      }

      return undefined;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns metrics when the configured bearer token is provided', () => {
    const controller = new ObservabilityController(
      observabilityService as never,
      configService as never,
    );

    const metrics = controller.metrics('Bearer metrics-secret-token');

    expect(metrics).toContain('banking_platform_build_info');
  });

  it('rejects metrics access when the bearer token is missing', () => {
    const controller = new ObservabilityController(
      observabilityService as never,
      configService as never,
    );

    expect(() => controller.metrics()).toThrow(UnauthorizedException);
  });
});

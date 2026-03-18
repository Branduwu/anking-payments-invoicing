import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HTTP_DURATION_BUCKETS_MS = [25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

export type DependencyMetricName = 'postgresql' | 'redis';

interface HttpRequestMetricInput {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

interface DependencyMetricInput {
  name: DependencyMetricName;
  status: 'up' | 'down';
  latencyMs?: number;
}

interface HistogramState {
  buckets: Map<number, number>;
  count: number;
  sum: number;
}

@Injectable()
export class ObservabilityService {
  private readonly httpRequestsTotal = new Map<string, number>();
  private readonly httpRequestDuration = new Map<string, HistogramState>();
  private readonly httpSlowRequestsTotal = new Map<string, number>();
  private readonly dependencyUp = new Map<DependencyMetricName, number>([
    ['postgresql', 0],
    ['redis', 0],
  ]);
  private readonly dependencyCheckLatencyMs = new Map<DependencyMetricName, number>();
  private readonly dependencyChecksTotal = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  recordHttpRequest(input: HttpRequestMetricInput): void {
    const normalizedPath = this.normalizeHttpPath(input.path);
    if (this.isMetricsPath(normalizedPath)) {
      return;
    }

    const requestLabels = {
      method: input.method.toUpperCase(),
      path: normalizedPath,
      status_code: String(input.statusCode),
    };
    this.incrementCounter(this.httpRequestsTotal, requestLabels);

    const durationLabels = {
      method: input.method.toUpperCase(),
      path: normalizedPath,
    };
    this.recordHistogram(durationLabels, input.durationMs);

    if (input.durationMs >= this.getSlowRequestThresholdMs()) {
      this.incrementCounter(this.httpSlowRequestsTotal, durationLabels);
    }
  }

  recordDependencyCheck(input: DependencyMetricInput): void {
    this.dependencyUp.set(input.name, input.status === 'up' ? 1 : 0);

    if (typeof input.latencyMs === 'number') {
      this.dependencyCheckLatencyMs.set(input.name, input.latencyMs);
    }

    this.incrementCounter(this.dependencyChecksTotal, {
      name: input.name,
      status: input.status,
    });
  }

  renderMetrics(): string {
    const metrics: string[] = [];
    const appName =
      this.configService.get<string>('app.name', { infer: true }) ?? 'banking-platform-api';
    const appVersion =
      this.configService.get<string>('app.version', { infer: true }) ?? '0.1.0';
    const appCommitSha =
      this.configService.get<string>('app.commitSha', { infer: true }) ?? 'local';
    const environment =
      this.configService.get<string>('app.env', { infer: true }) ?? 'development';

    metrics.push('# HELP banking_platform_build_info Build and deployment metadata.');
    metrics.push('# TYPE banking_platform_build_info gauge');
    metrics.push(
      `banking_platform_build_info{service="${this.escapeLabelValue(appName)}",version="${this.escapeLabelValue(appVersion)}",commit_sha="${this.escapeLabelValue(appCommitSha)}",environment="${this.escapeLabelValue(environment)}"} 1`,
    );

    metrics.push('# HELP banking_platform_process_uptime_seconds Current process uptime.');
    metrics.push('# TYPE banking_platform_process_uptime_seconds gauge');
    metrics.push(`banking_platform_process_uptime_seconds ${process.uptime().toFixed(3)}`);

    metrics.push(
      '# HELP banking_platform_process_resident_memory_bytes Resident memory used by the process.',
    );
    metrics.push('# TYPE banking_platform_process_resident_memory_bytes gauge');
    metrics.push(
      `banking_platform_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    );

    metrics.push('# HELP banking_platform_http_requests_total Total HTTP requests observed.');
    metrics.push('# TYPE banking_platform_http_requests_total counter');
    metrics.push(...this.renderCounter(this.httpRequestsTotal, 'banking_platform_http_requests_total'));

    metrics.push(
      '# HELP banking_platform_http_request_duration_ms HTTP request duration histogram in milliseconds.',
    );
    metrics.push('# TYPE banking_platform_http_request_duration_ms histogram');
    metrics.push(
      ...this.renderHistogram(
        this.httpRequestDuration,
        'banking_platform_http_request_duration_ms',
      ),
    );

    metrics.push(
      '# HELP banking_platform_http_slow_requests_total HTTP requests slower than the configured threshold.',
    );
    metrics.push('# TYPE banking_platform_http_slow_requests_total counter');
    metrics.push(
      ...this.renderCounter(
        this.httpSlowRequestsTotal,
        'banking_platform_http_slow_requests_total',
      ),
    );

    metrics.push(
      '# HELP banking_platform_dependency_up Latest dependency availability, 1 for up and 0 for down.',
    );
    metrics.push('# TYPE banking_platform_dependency_up gauge');
    for (const [name, value] of this.dependencyUp.entries()) {
      metrics.push(`banking_platform_dependency_up{name="${name}"} ${value}`);
    }

    metrics.push(
      '# HELP banking_platform_dependency_check_latency_ms Latest dependency check latency in milliseconds.',
    );
    metrics.push('# TYPE banking_platform_dependency_check_latency_ms gauge');
    for (const [name, value] of this.dependencyCheckLatencyMs.entries()) {
      metrics.push(`banking_platform_dependency_check_latency_ms{name="${name}"} ${value}`);
    }

    metrics.push(
      '# HELP banking_platform_dependency_checks_total Total dependency readiness checks by result.',
    );
    metrics.push('# TYPE banking_platform_dependency_checks_total counter');
    metrics.push(
      ...this.renderCounter(
        this.dependencyChecksTotal,
        'banking_platform_dependency_checks_total',
      ),
    );

    return `${metrics.join('\n')}\n`;
  }

  private recordHistogram(labels: Record<string, string>, durationMs: number): void {
    const key = this.serializeLabels(labels);
    const current =
      this.httpRequestDuration.get(key) ??
      {
        buckets: new Map<number, number>(),
        count: 0,
        sum: 0,
      };

    current.count += 1;
    current.sum += durationMs;

    for (const bucket of HTTP_DURATION_BUCKETS_MS) {
      if (durationMs <= bucket) {
        current.buckets.set(bucket, (current.buckets.get(bucket) ?? 0) + 1);
      }
    }

    this.httpRequestDuration.set(key, current);
  }

  private renderHistogram(
    store: Map<string, HistogramState>,
    metricName: string,
  ): string[] {
    const lines: string[] = [];

    for (const [serializedLabels, state] of store.entries()) {
      const labels = this.deserializeLabels(serializedLabels);

      for (const bucket of HTTP_DURATION_BUCKETS_MS) {
        lines.push(
          `${metricName}_bucket{${this.renderLabels({
            ...labels,
            le: String(bucket),
          })}} ${state.buckets.get(bucket) ?? 0}`,
        );
      }

      lines.push(
        `${metricName}_bucket{${this.renderLabels({
          ...labels,
          le: '+Inf',
        })}} ${state.count}`,
      );
      lines.push(`${metricName}_sum{${this.renderLabels(labels)}} ${state.sum.toFixed(3)}`);
      lines.push(`${metricName}_count{${this.renderLabels(labels)}} ${state.count}`);
    }

    return lines;
  }

  private renderCounter(store: Map<string, number>, metricName: string): string[] {
    const lines: string[] = [];

    for (const [serializedLabels, value] of store.entries()) {
      lines.push(`${metricName}{${this.renderLabels(this.deserializeLabels(serializedLabels))}} ${value}`);
    }

    return lines;
  }

  private incrementCounter(store: Map<string, number>, labels: Record<string, string>): void {
    const key = this.serializeLabels(labels);
    store.set(key, (store.get(key) ?? 0) + 1);
  }

  private serializeLabels(labels: Record<string, string>): string {
    return JSON.stringify(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
  }

  private deserializeLabels(serializedLabels: string): Record<string, string> {
    return Object.fromEntries(JSON.parse(serializedLabels) as Array<[string, string]>);
  }

  private renderLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}="${this.escapeLabelValue(value)}"`)
      .join(',');
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  private getSlowRequestThresholdMs(): number {
    return (
      this.configService.get<number>('app.observability.slowRequestThresholdMs', {
        infer: true,
      }) ?? 1_000
    );
  }

  private normalizeHttpPath(path: string): string {
    const rawPath = path.split('?')[0]?.split('#')[0] ?? '/';
    const normalizedPath = rawPath
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => this.normalizeSegment(segment))
      .join('/');

    return normalizedPath ? `/${normalizedPath}` : '/';
  }

  private normalizeSegment(segment: string): string {
    if (/^\d+$/.test(segment)) {
      return ':id';
    }

    if (/^[a-f0-9]{24,}$/i.test(segment)) {
      return ':token';
    }

    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        segment,
      )
    ) {
      return ':id';
    }

    return segment;
  }

  private isMetricsPath(path: string): boolean {
    return path === '/metrics' || path.endsWith('/metrics');
  }
}

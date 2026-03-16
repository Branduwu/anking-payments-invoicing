import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  constructor(private readonly configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuthenticatedRequest>();
    const response = httpContext.getResponse<FastifyReply>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest({
            request,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          });
        },
        error: (error: unknown) => {
          const statusCode = this.resolveErrorStatusCode(error, response);

          this.logRequest({
            request,
            statusCode,
            durationMs: Date.now() - startedAt,
            error,
          });
        },
      }),
    );
  }

  private logRequest(params: {
    request: AuthenticatedRequest;
    statusCode: number;
    durationMs: number;
    error?: unknown;
  }): void {
    const slowRequestThresholdMs =
      this.configService.get<number>('app.observability.slowRequestThresholdMs', {
        infer: true,
      }) ?? 1_000;
    const payload = JSON.stringify({
      event: 'http_request',
      timestamp: new Date().toISOString(),
      requestId: params.request.id,
      method: params.request.method,
      path: params.request.url,
      statusCode: params.statusCode,
      durationMs: params.durationMs,
      ipAddress: params.request.ip,
      userAgent:
        typeof params.request.headers['user-agent'] === 'string'
          ? params.request.headers['user-agent']
          : undefined,
      userId: params.request.user?.id,
    });

    if (params.error instanceof HttpException) {
      this.logger.warn(payload);
      return;
    }

    if (params.statusCode >= 500) {
      this.logger.error(
        payload,
        params.error instanceof Error ? params.error.stack : undefined,
      );
      return;
    }

    if (params.statusCode >= 400 || params.durationMs >= slowRequestThresholdMs) {
      this.logger.warn(payload);
      return;
    }

    this.logger.log(payload);
  }

  private resolveErrorStatusCode(error: unknown, response: FastifyReply): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (typeof response.statusCode === 'number' && response.statusCode >= 400) {
      return response.statusCode;
    }

    return 500;
  }
}

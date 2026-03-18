import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

const DEPENDENCY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
]);

const DEPENDENCY_ERROR_NAMES = new Set(['MaxRetriesPerRequestError']);

const DEPENDENCY_ERROR_MESSAGES = new Set([
  'connection is closed',
  'redis session store unavailable',
  'audit persistence unavailable',
]);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const timestamp = new Date().toISOString();
    const requestId = request.id;

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : ((exceptionResponse as { message?: string | string[] }).message ??
            exception.message);
      const responsePayload =
        typeof exceptionResponse === 'string'
          ? {}
          : (exceptionResponse as Record<string, unknown>);

      response.status(statusCode).send({
        statusCode,
        timestamp,
        path: request.url,
        requestId,
        ...responsePayload,
        message,
      });
      return;
    }

    if (isDependencyUnavailableError(exception)) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).send({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'A required dependency is unavailable',
        timestamp,
        path: request.url,
        requestId,
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : 'Internal server error';
    this.logger.error(
      `[${requestId}] ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
      path: request.url,
      requestId,
    });
  }
}

const isDependencyUnavailableError = (exception: unknown): boolean => {
  const queue: unknown[] = [exception];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current instanceof Prisma.PrismaClientInitializationError) {
      return true;
    }

    if (current instanceof Error) {
      if (DEPENDENCY_ERROR_NAMES.has(current.name)) {
        return true;
      }

      const code = (current as { code?: string }).code;
      if (code && DEPENDENCY_ERROR_CODES.has(code)) {
        return true;
      }

      const normalizedMessage = normalizeMessage(current.message);
      if (normalizedMessage && DEPENDENCY_ERROR_MESSAGES.has(normalizedMessage)) {
        return true;
      }

      const cause = (current as { cause?: unknown }).cause;
      if (cause) {
        queue.push(cause);
      }
      continue;
    }

    if (typeof current === 'object' && current !== null && 'cause' in current) {
      queue.push((current as { cause?: unknown }).cause);
    }
  }

  return false;
};

const normalizeMessage = (message: string | undefined): string | null => {
  if (!message) {
    return null;
  }

  return message.trim().replace(/\.+$/, '').toLowerCase();
};

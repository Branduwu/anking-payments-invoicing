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

      response.status(statusCode).send({
        statusCode,
        message,
        timestamp,
        path: request.url,
        requestId,
      });
      return;
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      (exception instanceof Error &&
        (('code' in exception && (exception as { code?: string }).code === 'ECONNREFUSED') ||
          /Connection is closed|Redis session store unavailable|Audit persistence unavailable/i.test(
            exception.message,
          )))
    ) {
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

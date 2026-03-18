import 'reflect-metadata';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as classTransformer from 'class-transformer';
import * as classValidator from 'class-validator';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { evaluateCsrfProtection } from './common/http/csrf-origin-protection';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
    }),
  );

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('app.apiPrefix', { infer: true }) ?? 'api';
  const port = configService.get<number>('app.port', { infer: true }) ?? 4000;
  const cookieSecret = configService.get<string>('app.cookie.secret', { infer: true }) ?? '';
  const configuredCorsOrigins = configService.get<string[] | string>('app.corsOrigin', {
    infer: true,
  });
  const corsOrigins = Array.isArray(configuredCorsOrigins)
    ? configuredCorsOrigins
    : typeof configuredCorsOrigins === 'string'
      ? [configuredCorsOrigins]
      : ['http://localhost:3000'];
  const cookieName =
    configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';
  const configuredCsrfTrustedOrigins = configService.get<string[] | string>(
    'app.security.csrfTrustedOrigins',
    { infer: true },
  );
  const csrfTrustedOrigins = Array.isArray(configuredCsrfTrustedOrigins)
    ? configuredCsrfTrustedOrigins
    : typeof configuredCsrfTrustedOrigins === 'string'
      ? [configuredCsrfTrustedOrigins]
      : corsOrigins;

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cookie, {
    secret: cookieSecret,
  });
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preHandler', async (request, reply) => {
    const decision = evaluateCsrfProtection(
      {
        method: request.method,
        url: request.url,
        cookies: request.cookies,
        headers: request.headers as Record<string, string | string[] | undefined>,
      },
      {
        apiPrefix,
        cookieName,
        trustedOrigins: csrfTrustedOrigins,
      },
    );

    if (!decision.allowed) {
      return reply.status(403).send({
        statusCode: 403,
        message: 'Request origin is not allowed for cookie-backed mutation',
        reason: decision.reason,
        detail: decision.detail,
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId: request.id,
      });
    }
  });

  app.enableShutdownHooks();
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
      forbidNonWhitelisted: true,
      validatorPackage: classValidator,
      transformerPackage: classTransformer,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(port, '0.0.0.0');
}

void bootstrap();

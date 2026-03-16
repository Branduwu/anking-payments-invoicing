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
  const corsOrigins =
    configService.get<string[]>('app.corsOrigin', { infer: true }) ?? ['http://localhost:3000'];

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

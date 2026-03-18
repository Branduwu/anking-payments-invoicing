import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'node:path';
import appConfig from './common/config/app.config';
import { validateEnv } from './common/config/env.validation';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SessionsModule } from './modules/sessions/sessions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), 'apps/api/.env'),
        resolve(process.cwd(), '../../.env'),
      ],
      load: [appConfig],
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    ObservabilityModule,
    SessionsModule,
    HealthModule,
    AuthModule,
    CustomersModule,
    PaymentsModule,
    InvoicesModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}

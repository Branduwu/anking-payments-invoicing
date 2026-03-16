import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import appConfig from './common/config/app.config';
import { validateEnv } from './common/config/env.validation';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
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
    SessionsModule,
    HealthModule,
    AuthModule,
    PaymentsModule,
    InvoicesModule,
  ],
})
export class AppModule {}

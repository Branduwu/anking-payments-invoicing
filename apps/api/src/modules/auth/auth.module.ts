import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, MfaService],
})
export class AuthModule {}

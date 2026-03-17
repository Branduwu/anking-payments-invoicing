import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';
import { WebAuthnService } from './webauthn.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, MfaService, WebAuthnService],
})
export class AuthModule {}

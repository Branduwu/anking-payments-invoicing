import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSessionCookieOptions } from '../../common/config/cookie-options';
import { AllowPendingMfa } from '../../common/decorators/allow-pending-mfa.decorator';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { RequireRecentReauth } from '../../common/decorators/require-recent-reauth.decorator';
import { RecentReauthGuard } from '../../common/guards/recent-reauth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { getRequestMetadata } from '../../common/http/request-metadata';
import type { ActiveSession } from '../sessions/session.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaAdminResetDto } from './dto/mfa-admin-reset.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import type { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { ReauthenticateDto } from './dto/reauthenticate.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() payload: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ mfaRequired: boolean; message: string }> {
    const result = await this.authService.login(payload, getRequestMetadata(request));
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';

    reply.setCookie(cookieName, result.sessionId, getSessionCookieOptions(this.configService));

    return {
      mfaRequired: result.mfaRequired,
      message: 'Login successful',
    };
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @AllowPendingMfa()
  async logout(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ message: string }> {
    await this.authService.logout(session, getRequestMetadata(request));
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';

    reply.clearCookie(cookieName, getSessionCookieOptions(this.configService));

    return {
      message: 'Logout successful',
    };
  }

  @Post('refresh')
  @UseGuards(SessionAuthGuard)
  async refresh(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ message: string }> {
    const nextSession = await this.authService.refresh(session, getRequestMetadata(request));
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';

    reply.setCookie(cookieName, nextSession.id, getSessionCookieOptions(this.configService));

    return {
      message: 'Session refreshed',
    };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(
    @CurrentSession() session: ActiveSession,
  ): Promise<{
    user: {
      id: string;
      email: string;
      displayName: string | null;
      status: string;
      mfaEnabled: boolean;
      roles: string[];
      recoveryCodesRemaining: number;
    };
    session: ActiveSession;
  }> {
    return this.authService.getMe(session);
  }

  @Post('mfa/setup')
  @UseGuards(SessionAuthGuard, RecentReauthGuard)
  @RequireRecentReauth()
  async setupMfa(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<MfaSetupResponseDto> {
    return this.authService.setupMfa(session, getRequestMetadata(request));
  }

  @Post('reauthenticate')
  @UseGuards(SessionAuthGuard)
  async reauthenticate(
    @CurrentSession() session: ActiveSession,
    @Body() payload: ReauthenticateDto,
    @Req() request: FastifyRequest,
  ): Promise<{ reauthenticatedUntil?: Date; message: string }> {
    const updatedSession = await this.authService.reauthenticate(
      session,
      payload,
      getRequestMetadata(request),
    );

    return {
      reauthenticatedUntil: updatedSession.reauthenticatedUntil,
      message: 'Reauthentication successful',
    };
  }

  @Post('mfa/verify')
  @UseGuards(SessionAuthGuard)
  @AllowPendingMfa()
  async verifyMfa(
    @CurrentSession() session: ActiveSession,
    @Body() payload: MfaVerifyDto,
    @Req() request: FastifyRequest,
  ): Promise<{
    reauthenticatedUntil?: Date;
    recoveryCodes?: string[];
    remainingRecoveryCodes: number;
  }> {
    const result = await this.authService.verifyMfa(
      session,
      payload,
      getRequestMetadata(request),
    );

    return {
      reauthenticatedUntil: result.session.reauthenticatedUntil,
      recoveryCodes: result.recoveryCodes,
      remainingRecoveryCodes: result.remainingRecoveryCodes,
    };
  }

  @Post('mfa/recovery-codes/regenerate')
  @UseGuards(SessionAuthGuard, RecentReauthGuard)
  @RequireRecentReauth()
  async regenerateRecoveryCodes(
    @CurrentSession() session: ActiveSession,
    @Req() request: FastifyRequest,
  ): Promise<{ recoveryCodes: string[]; remainingRecoveryCodes: number }> {
    return this.authService.regenerateRecoveryCodes(session, getRequestMetadata(request));
  }

  @Post('mfa/disable')
  @UseGuards(SessionAuthGuard, RecentReauthGuard)
  @RequireRecentReauth()
  async disableMfa(
    @CurrentSession() session: ActiveSession,
    @Body() payload: MfaDisableDto,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string; mfaLevel: string }> {
    const updatedSession = await this.authService.disableMfa(
      session,
      payload,
      getRequestMetadata(request),
    );

    return {
      message: 'MFA disabled',
      mfaLevel: updatedSession.mfaLevel,
    };
  }

  @Post('mfa/admin/reset')
  @UseGuards(SessionAuthGuard, RecentReauthGuard)
  @RequireRecentReauth()
  async adminResetMfa(
    @CurrentSession() session: ActiveSession,
    @Body() payload: MfaAdminResetDto,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    await this.authService.adminResetMfa(session, payload, getRequestMetadata(request));
    return {
      message: 'MFA reset completed',
    };
  }
}

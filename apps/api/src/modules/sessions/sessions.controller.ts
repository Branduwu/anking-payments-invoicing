import { Controller, Delete, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { getSessionCookieOptions } from '../../common/config/cookie-options';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import type { ActiveSession } from './session.types';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(SessionAuthGuard)
export class SessionsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Get()
  async list(@CurrentSession() session: ActiveSession): Promise<{
    currentSessionId: string;
    items: ActiveSession[];
  }> {
    return {
      currentSessionId: session.id,
      items: await this.sessionsService.listUserSessions(session.userId),
    };
  }

  @Delete('all')
  async revokeAll(
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ revokedCount: number }> {
    const revokedCount = await this.sessionsService.revokeAllSessions(
      session.userId,
      'user-requested-global-revoke',
    );
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';

    reply.clearCookie(cookieName, getSessionCookieOptions(this.configService));
    return { revokedCount };
  }

  @Delete(':id')
  async revokeOne(
    @CurrentSession() session: ActiveSession,
    @Param('id') targetSessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ revoked: boolean; sessionId: string }> {
    const revoked = await this.sessionsService.revokeSession(
      session.userId,
      targetSessionId,
      'user-requested-single-revoke',
    );

    if (targetSessionId === session.id && revoked) {
      const cookieName =
        this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';
      reply.clearCookie(cookieName, getSessionCookieOptions(this.configService));
    }

    return {
      revoked,
      sessionId: targetSessionId,
    };
  }
}


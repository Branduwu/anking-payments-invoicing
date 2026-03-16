import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { ALLOW_PENDING_MFA_KEY } from '../decorators/allow-pending-mfa.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';
    const sessionId = request.cookies?.[cookieName];

    if (!sessionId) {
      throw new UnauthorizedException('Session cookie missing');
    }

    const session = await this.sessionsService.validateSession(sessionId);

    if (!session) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const allowPendingMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (session.requiresMfa && !allowPendingMfa) {
      throw new UnauthorizedException('MFA verification required');
    }

    request.session = session;
    request.user = { id: session.userId };
    return true;
  }
}

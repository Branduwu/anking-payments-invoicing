import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../modules/audit/audit.service';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { ALLOW_PENDING_MFA_KEY } from '../decorators/allow-pending-mfa.decorator';
import { getRequestMetadata } from '../http/request-metadata';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly sessionsService: SessionsService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName =
      this.configService.get<string>('app.cookie.name', { infer: true }) ?? '__Host-session';
    const sessionId = request.cookies?.[cookieName];

    if (!sessionId) {
      await this.auditDenied(request, 'auth.session.denied', {
        reason: 'session-cookie-missing',
      });
      throw new UnauthorizedException('Session cookie missing');
    }

    const session = await this.sessionsService.validateSession(sessionId);

    if (!session) {
      await this.auditDenied(request, 'auth.session.denied', {
        reason: 'session-invalid-or-expired',
        sessionId,
      });
      throw new UnauthorizedException('Session invalid or expired');
    }

    const allowPendingMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (session.requiresMfa && !allowPendingMfa) {
      await this.auditDenied(request, 'auth.mfa.denied', {
        reason: 'mfa-verification-required',
        sessionId: session.id,
        userId: session.userId,
      });
      throw new UnauthorizedException('MFA verification required');
    }

    request.session = session;
    request.user = { id: session.userId };
    return true;
  }

  private async auditDenied(
    request: AuthenticatedRequest,
    action: string,
    payload: {
      reason: string;
      sessionId?: string;
      userId?: string;
    },
  ): Promise<void> {
    await this.auditService.record({
      action,
      result: 'DENIED',
      userId: payload.userId,
      requestId: request.id,
      ipAddress: getRequestMetadata(request).ipAddress,
      entityType: 'session',
      entityId: payload.sessionId,
      metadata: {
        reason: payload.reason,
        method: request.method,
        path: request.url,
      },
    });
  }
}

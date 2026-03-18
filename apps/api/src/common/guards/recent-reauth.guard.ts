import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../modules/audit/audit.service';
import { REQUIRES_RECENT_REAUTH_KEY } from '../decorators/require-recent-reauth.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class RecentReauthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiresRecentReauth = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_RECENT_REAUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresRecentReauth) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.session;

    if (!session?.reauthenticatedUntil) {
      await this.auditService.record({
        action: 'auth.reauthenticate.denied',
        result: 'DENIED',
        userId: session?.userId,
        requestId: request.id,
        ipAddress: request.ip,
        entityType: 'session',
        entityId: session?.id,
        metadata: {
          reason: 'recent-reauth-missing',
          method: request.method,
          path: request.url,
        },
      });
      throw new ForbiddenException('Recent reauthentication required');
    }

    if (session.reauthenticatedUntil.getTime() < Date.now()) {
      await this.auditService.record({
        action: 'auth.reauthenticate.denied',
        result: 'DENIED',
        userId: session.userId,
        requestId: request.id,
        ipAddress: request.ip,
        entityType: 'session',
        entityId: session.id,
        metadata: {
          reason: 'recent-reauth-expired',
          method: request.method,
          path: request.url,
        },
      });
      throw new ForbiddenException('Recent reauthentication required');
    }

    return true;
  }
}

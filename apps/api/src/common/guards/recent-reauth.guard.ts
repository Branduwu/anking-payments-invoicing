import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_RECENT_REAUTH_KEY } from '../decorators/require-recent-reauth.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class RecentReauthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
      throw new ForbiddenException('Recent reauthentication required');
    }

    if (session.reauthenticatedUntil.getTime() < Date.now()) {
      throw new ForbiddenException('Recent reauthentication required');
    }

    return true;
  }
}


import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import type { ActiveSession, MfaLevel, SessionContext } from './session.types';

@Injectable()
export class SessionsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly auditService: AuditService,
  ) {}

  async createSession(
    userId: string,
    context: SessionContext,
    mfaLevel: MfaLevel = 'none',
    requiresMfa = false,
  ): Promise<ActiveSession> {
    this.redisService.assertAvailable();
    const now = new Date();
    const session: ActiveSession = {
      id: randomUUID(),
      userId,
      status: 'active',
      mfaLevel,
      requiresMfa,
      createdAt: now,
      lastActivity: now,
      expiresAt: new Date(now.getTime() + this.getIdleTimeoutMs()),
      absoluteExpiresAt: new Date(now.getTime() + this.getAbsoluteTimeoutMs()),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    };

    await this.persistSession(session);
    await this.redisService.client.sadd(this.getUserSessionsKey(userId), session.id);
    try {
      await this.auditService.record(
        {
          action: 'session.created',
          result: 'SUCCESS',
          userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          entityType: 'session',
          entityId: session.id,
        },
        {
          failClosed: true,
        },
      );
    } catch (error) {
      await this.deleteSession(userId, session.id);
      throw error;
    }

    return session;
  }

  async validateSession(sessionId: string): Promise<ActiveSession | null> {
    this.redisService.assertAvailable();
    const session = await this.getSession(sessionId);

    if (!session || session.status !== 'active') {
      return null;
    }

    const now = new Date();
    if (
      session.expiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      session.status = 'expired';
      await this.deleteSession(session.userId, sessionId);
      return null;
    }

    session.lastActivity = now;
    session.expiresAt = new Date(now.getTime() + this.getIdleTimeoutMs());
    await this.persistSession(session);
    return session;
  }

  async rotateSession(sessionId: string, context: SessionContext): Promise<ActiveSession> {
    this.redisService.assertAvailable();
    const currentSession = await this.validateSession(sessionId);

    if (!currentSession) {
      throw new UnauthorizedException('Current session is not valid');
    }

    await this.revokeSession(currentSession.userId, currentSession.id, 'session-rotation');
    const nextSession = await this.createSession(
      currentSession.userId,
      context,
      currentSession.mfaLevel,
      currentSession.requiresMfa ?? false,
    );
    nextSession.reauthenticatedUntil = currentSession.reauthenticatedUntil;
    await this.persistSession(nextSession);
    return nextSession;
  }

  async listUserSessions(userId: string): Promise<ActiveSession[]> {
    this.redisService.assertAvailable();
    const sessionIds = await this.redisService.client.smembers(this.getUserSessionsKey(userId));

    if (sessionIds.length === 0) {
      return [];
    }

    const pipeline = this.redisService.client.pipeline();
    for (const sessionId of sessionIds) {
      pipeline.get(this.getSessionKey(sessionId));
    }

    const pipelineResult = await pipeline.exec();
    const sessions: ActiveSession[] = [];
    const staleSessionIds: string[] = [];

    for (let index = 0; index < sessionIds.length; index += 1) {
      const sessionId = sessionIds[index];
      const entry = pipelineResult?.[index];

      if (!entry || entry[0] || !entry[1]) {
        staleSessionIds.push(sessionId);
        continue;
      }

      const payload = typeof entry[1] === 'string' ? entry[1] : null;
      if (!payload) {
        staleSessionIds.push(sessionId);
        continue;
      }

      const session = this.deserializeSession(payload);
      const isExpired =
        session.expiresAt.getTime() <= Date.now() || session.absoluteExpiresAt.getTime() <= Date.now();

      if (isExpired || session.status !== 'active') {
        staleSessionIds.push(sessionId);
        continue;
      }

      sessions.push(session);
    }

    if (staleSessionIds.length > 0) {
      await this.redisService.client.srem(this.getUserSessionsKey(userId), ...staleSessionIds);
    }

    return sessions.sort((left, right) => right.lastActivity.getTime() - left.lastActivity.getTime());
  }

  async revokeSession(userId: string, sessionId: string, reason: string): Promise<boolean> {
    this.redisService.assertAvailable();
    const session = await this.getSession(sessionId);

    if (!session || session.userId !== userId) {
      return false;
    }

    const sessionBeforeRevocation: ActiveSession = {
      ...session,
    };
    session.status = 'revoked';
    session.revokedReason = reason;
    await this.deleteSession(userId, sessionId);
    try {
      await this.auditService.record(
        {
          action: 'session.revoked',
          result: 'SUCCESS',
          userId,
          entityType: 'session',
          entityId: sessionId,
          metadata: {
            reason,
          },
        },
        {
          failClosed: true,
        },
      );
    } catch (error) {
      await this.persistSession(sessionBeforeRevocation);
      await this.redisService.client.sadd(this.getUserSessionsKey(userId), sessionId);
      throw error;
    }

    return true;
  }

  async revokeAllSessions(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    this.redisService.assertAvailable();
    const sessionIds = await this.redisService.client.smembers(this.getUserSessionsKey(userId));
    let revokedCount = 0;

    for (const sessionId of sessionIds) {
      if (exceptSessionId && sessionId === exceptSessionId) {
        continue;
      }

      const revoked = await this.revokeSession(userId, sessionId, reason);
      if (revoked) {
        revokedCount += 1;
      }
    }

    return revokedCount;
  }

  async markReauthenticated(sessionId: string): Promise<ActiveSession | null> {
    this.redisService.assertAvailable();
    const session = await this.validateSession(sessionId);

    if (!session) {
      return null;
    }

    session.reauthenticatedUntil = new Date(Date.now() + this.getReauthWindowMs());
    await this.persistSession(session);
    return session;
  }

  async updateMfaLevel(sessionId: string, mfaLevel: MfaLevel): Promise<ActiveSession | null> {
    this.redisService.assertAvailable();
    const session = await this.validateSession(sessionId);

    if (!session) {
      return null;
    }

    session.mfaLevel = mfaLevel;
    await this.persistSession(session);
    return session;
  }

  async completeMfaChallenge(sessionId: string, mfaLevel: MfaLevel): Promise<ActiveSession | null> {
    this.redisService.assertAvailable();
    const session = await this.validateSession(sessionId);

    if (!session) {
      return null;
    }

    session.mfaLevel = mfaLevel;
    session.requiresMfa = false;
    await this.persistSession(session);
    return session;
  }

  private async getSession(sessionId: string): Promise<ActiveSession | null> {
    const payload = await this.redisService.client.get(this.getSessionKey(sessionId));
    return payload ? this.deserializeSession(payload) : null;
  }

  private async persistSession(session: ActiveSession): Promise<void> {
    await this.redisService.client.set(
      this.getSessionKey(session.id),
      this.serializeSession(session),
      'EX',
      this.getSessionTtlSeconds(session),
    );
  }

  private async deleteSession(userId: string, sessionId: string): Promise<void> {
    await this.redisService.client
      .multi()
      .del(this.getSessionKey(sessionId))
      .srem(this.getUserSessionsKey(userId), sessionId)
      .exec();
  }

  private serializeSession(session: ActiveSession): string {
    return JSON.stringify({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      reauthenticatedUntil: session.reauthenticatedUntil?.toISOString(),
    });
  }

  private deserializeSession(payload: string): ActiveSession {
    const parsed = JSON.parse(payload) as Omit<
      ActiveSession,
      | 'createdAt'
      | 'lastActivity'
      | 'expiresAt'
      | 'absoluteExpiresAt'
      | 'reauthenticatedUntil'
    > & {
      createdAt: string;
      lastActivity: string;
      expiresAt: string;
      absoluteExpiresAt: string;
      reauthenticatedUntil?: string;
    };

    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastActivity: new Date(parsed.lastActivity),
      expiresAt: new Date(parsed.expiresAt),
      absoluteExpiresAt: new Date(parsed.absoluteExpiresAt),
      requiresMfa: parsed.requiresMfa ?? false,
      reauthenticatedUntil: parsed.reauthenticatedUntil
        ? new Date(parsed.reauthenticatedUntil)
        : undefined,
    };
  }

  private getSessionTtlSeconds(session: ActiveSession): number {
    const remainingMs = Math.min(
      session.expiresAt.getTime() - Date.now(),
      session.absoluteExpiresAt.getTime() - Date.now(),
    );

    return Math.max(1, Math.floor(remainingMs / 1000));
  }

  private getSessionKey(sessionId: string): string {
    return `${this.getRedisPrefix()}:session:${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `${this.getRedisPrefix()}:user_sessions:${userId}`;
  }

  private getRedisPrefix(): string {
    return this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
  }

  private getIdleTimeoutMs(): number {
    const minutes =
      this.configService.get<number>('app.session.idleTimeoutMinutes', { infer: true }) ?? 15;
    return minutes * 60_000;
  }

  private getAbsoluteTimeoutMs(): number {
    const hours =
      this.configService.get<number>('app.session.absoluteTimeoutHours', { infer: true }) ?? 8;
    return hours * 3_600_000;
  }

  private getReauthWindowMs(): number {
    const minutes =
      this.configService.get<number>('app.session.reauthWindowMinutes', { infer: true }) ?? 5;
    return minutes * 60_000;
  }
}

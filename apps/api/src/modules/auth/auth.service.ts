import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { verify } from 'argon2';
import type { RequestMetadata } from '../../common/http/request-metadata';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { MfaLevel, ActiveSession } from '../sessions/session.types';
import { SessionsService } from '../sessions/sessions.service';
import { MfaAdminResetDto } from './dto/mfa-admin-reset.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import type { LoginDto } from './dto/login.dto';
import type { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';
import type { MfaVerifyDto } from './dto/mfa-verify.dto';
import type { ReauthenticateDto } from './dto/reauthenticate.dto';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { MfaService } from './mfa.service';

interface LoginResult {
  sessionId: string;
  mfaRequired: boolean;
}

interface VerifyMfaResult {
  session: ActiveSession;
  recoveryCodes?: string[];
  remainingRecoveryCodes: number;
}

interface RecoveryCodesResult {
  recoveryCodes: string[];
  remainingRecoveryCodes: number;
}

interface UserMfaStateSnapshot {
  mfaEnabled: boolean;
  mfaTotpSecretEnc: string | null;
  mfaRecoveryCodes: string[];
  mfaRecoveryCodesGeneratedAt: Date | null;
}

@Injectable()
export class AuthService {
  private readonly adminResetRoles: UserRole[] = [UserRole.ADMIN, UserRole.SECURITY];

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
    private readonly sessionsService: SessionsService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly mfaService: MfaService,
  ) {}

  async login(payload: LoginDto, metadata: RequestMetadata): Promise<LoginResult> {
    const email = this.normalizeEmail(payload.email);
    await this.assertLoginAllowed(email, metadata);
    const user = await this.prismaService.user.findUnique({
      where: { email },
      include: {
        credentials: true,
      },
    });

    if (!user || !user.credentials) {
      await this.authRateLimitService.registerLoginFailure(email, metadata.ipAddress);
      await this.auditFailure('auth.login.failure', metadata, undefined, {
        reason: 'user-not-found-or-no-credentials',
        email,
      });
      throw this.invalidCredentialsError();
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.authRateLimitService.registerLoginFailure(email, metadata.ipAddress);
      await this.auditFailure('auth.login.denied', metadata, user.id, {
        reason: 'user-not-active',
        status: user.status,
      });
      throw this.invalidCredentialsError();
    }

    if (user.credentials.lockedUntil && user.credentials.lockedUntil.getTime() > Date.now()) {
      await this.authRateLimitService.registerLoginFailure(email, metadata.ipAddress);
      await this.auditFailure('auth.login.denied', metadata, user.id, {
        reason: 'credential-lockout',
        lockedUntil: user.credentials.lockedUntil.toISOString(),
      });
      throw this.invalidCredentialsError();
    }

    const passwordIsValid = await verify(user.credentials.passwordHash, payload.password);

    if (!passwordIsValid) {
      await this.registerFailedLogin(user.id, user.credentials.failedLoginCount);
      await this.authRateLimitService.registerLoginFailure(email, metadata.ipAddress);
      await this.auditFailure('auth.login.failure', metadata, user.id, {
        reason: 'invalid-password',
      });
      throw this.invalidCredentialsError();
    }

    await this.resetFailedLogin(user.id);
    await this.authRateLimitService.clearLoginFailures(email, metadata.ipAddress);

    const session = await this.sessionsService.createSession(
      user.id,
      metadata,
      'none',
      user.mfaEnabled,
    );

    if (!user.mfaEnabled) {
      await this.sessionsService.markReauthenticated(session.id);
    }

    await this.auditService.record({
      action: 'auth.login.success',
      result: 'SUCCESS',
      userId: user.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'session',
      entityId: session.id,
      metadata: {
        mfaRequired: user.mfaEnabled,
      },
    });

    return {
      sessionId: session.id,
      mfaRequired: user.mfaEnabled,
    };
  }

  async logout(session: ActiveSession, metadata: RequestMetadata): Promise<void> {
    await this.sessionsService.revokeSession(session.userId, session.id, 'logout');
    await this.auditService.record({
      action: 'auth.logout.success',
      result: 'SUCCESS',
      userId: session.userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'session',
      entityId: session.id,
    });
  }

  async refresh(session: ActiveSession, metadata: RequestMetadata): Promise<ActiveSession> {
    const nextSession = await this.sessionsService.rotateSession(session.id, metadata);
    await this.auditService.record({
      action: 'auth.refresh.success',
      result: 'SUCCESS',
      userId: session.userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'session',
      entityId: nextSession.id,
      metadata: {
        previousSessionId: session.id,
      },
    });
    return nextSession;
  }

  async getMe(session: ActiveSession): Promise<{
    user: {
      id: string;
      email: string;
      displayName: string | null;
      status: UserStatus;
      mfaEnabled: boolean;
      roles: string[];
      recoveryCodesRemaining: number;
    };
    session: ActiveSession;
  }> {
    const user = await this.prismaService.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: {
        roles: {
          select: {
            role: true,
          },
        },
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        mfaEnabled: user.mfaEnabled,
        roles: user.roles.map((role) => role.role),
        recoveryCodesRemaining: user.mfaRecoveryCodes.length,
      },
      session,
    };
  }

  async setupMfa(session: ActiveSession, metadata: RequestMetadata): Promise<MfaSetupResponseDto> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        mfaEnabled: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    if (user.mfaEnabled) {
      throw new ConflictException('MFA is already enabled for this account');
    }

    const setup = await this.mfaService.createSetup(session.id, user.email);

    await this.auditService.record({
      action: 'auth.mfa.setup.created',
      result: 'SUCCESS',
      userId: user.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'session',
      entityId: session.id,
    });

    return setup;
  }

  async reauthenticate(
    session: ActiveSession,
    payload: ReauthenticateDto,
    metadata: RequestMetadata,
  ): Promise<ActiveSession> {
    await this.assertReauthenticationAllowed(session.userId, metadata);
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      include: {
        credentials: true,
      },
    });

    if (!user || !user.credentials) {
      await this.authRateLimitService.registerReauthenticationFailure(
        session.userId,
        metadata.ipAddress,
      );
      await this.auditFailure('auth.reauthenticate.failure', metadata, session.userId, {
        reason: 'user-not-found-or-no-credentials',
      });
      throw this.invalidCredentialsError();
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.authRateLimitService.registerReauthenticationFailure(
        session.userId,
        metadata.ipAddress,
      );
      await this.auditFailure('auth.reauthenticate.denied', metadata, user.id, {
        reason: 'user-not-active',
        status: user.status,
      });
      throw this.invalidCredentialsError();
    }

    if (user.credentials.lockedUntil && user.credentials.lockedUntil.getTime() > Date.now()) {
      await this.authRateLimitService.registerReauthenticationFailure(
        session.userId,
        metadata.ipAddress,
      );
      await this.auditFailure('auth.reauthenticate.denied', metadata, user.id, {
        reason: 'credential-lockout',
        lockedUntil: user.credentials.lockedUntil.toISOString(),
      });
      throw this.invalidCredentialsError();
    }

    if (user.mfaEnabled) {
      throw new BadRequestException(
        'Use /auth/mfa/verify para reautenticacion cuando MFA este habilitado.',
      );
    }

    const passwordIsValid = await verify(user.credentials.passwordHash, payload.password);
    if (!passwordIsValid) {
      await this.registerFailedLogin(user.id, user.credentials.failedLoginCount);
      await this.authRateLimitService.registerReauthenticationFailure(
        session.userId,
        metadata.ipAddress,
      );
      await this.auditFailure('auth.reauthenticate.failure', metadata, user.id, {
        reason: 'invalid-password',
      });
      throw this.invalidCredentialsError();
    }

    await this.resetFailedLogin(user.id);
    await this.authRateLimitService.clearReauthenticationFailures(
      session.userId,
      metadata.ipAddress,
    );

    const updatedSession = await this.sessionsService.markReauthenticated(session.id);
    if (!updatedSession) {
      throw new UnauthorizedException('Current session is not valid');
    }

    await this.auditService.record({
      action: 'auth.reauthenticate.success',
      result: 'SUCCESS',
      userId: user.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      entityType: 'session',
      entityId: session.id,
    });

    return updatedSession;
  }

  async verifyMfa(
    session: ActiveSession,
    payload: MfaVerifyDto,
    metadata: RequestMetadata,
  ): Promise<VerifyMfaResult> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
        mfaRecoveryCodes: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    let recoveryCodes: string[] | undefined;
    let remainingRecoveryCodes = user.mfaRecoveryCodes.length;
    let sessionMfaLevel: MfaLevel = 'totp';

    if (user.mfaEnabled && user.mfaTotpSecretEnc) {
      if (payload.method === 'recovery_code') {
        const recoveryResult = await this.mfaService.consumeRecoveryCode(
          user.mfaRecoveryCodes,
          payload.code,
          {
            scope: 'recovery',
            actorId: user.id,
          },
        );

        if (!recoveryResult.matched) {
          await this.auditFailure('auth.mfa.verify.failure', metadata, user.id, {
            reason: 'invalid-recovery-code',
          });
          throw this.invalidCredentialsError();
        }

        remainingRecoveryCodes = recoveryResult.remainingHashes.length;
        sessionMfaLevel = 'recovery';

        await this.prismaService.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              mfaRecoveryCodes: recoveryResult.remainingHashes,
            },
          });

          await tx.auditEvent.create({
            data: this.auditService.buildCreateData({
              action: 'auth.mfa.verify.success',
              result: 'SUCCESS',
              userId: user.id,
              requestId: metadata.requestId,
              ipAddress: metadata.ipAddress,
              entityType: 'session',
              entityId: session.id,
              metadata: {
                mode: 'recovery_code',
                remainingRecoveryCodes,
              },
            }),
          });
        });
      } else {
        const verified = await this.mfaService.verifyEncryptedSecret(
          user.mfaTotpSecretEnc,
          payload.code,
          {
            scope: 'totp',
            actorId: user.id,
          },
        );

        if (!verified) {
          await this.auditFailure('auth.mfa.verify.failure', metadata, user.id, {
            reason: 'invalid-totp-code',
          });
          throw this.invalidCredentialsError();
        }

        await this.auditService.record({
          action: 'auth.mfa.verify.success',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'session',
          entityId: session.id,
          metadata: {
            mode: 'totp',
            remainingRecoveryCodes,
          },
        });
      }
    } else {
      const pendingSecret = await this.mfaService.verifyPendingSetup(session.id, payload.code);
      if (!pendingSecret) {
        await this.auditFailure('auth.mfa.verify.failure', metadata, user.id, {
          reason: 'missing-or-invalid-pending-setup',
        });
        throw new BadRequestException('No valid pending MFA setup found for this session');
      }

      const generatedRecoveryCodes = this.mfaService.generateRecoveryCodes();
      recoveryCodes = generatedRecoveryCodes.codes;
      remainingRecoveryCodes = generatedRecoveryCodes.codes.length;

      await this.prismaService.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            mfaEnabled: true,
            mfaTotpSecretEnc: pendingSecret,
            mfaRecoveryCodes: generatedRecoveryCodes.hashes,
            mfaRecoveryCodesGeneratedAt: new Date(),
          },
        });

        await tx.auditEvent.create({
          data: this.auditService.buildCreateData({
            action: 'auth.mfa.verify.success',
            result: 'SUCCESS',
            userId: user.id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            entityType: 'session',
            entityId: session.id,
            metadata: {
              mode: 'enrollment',
              remainingRecoveryCodes,
            },
          }),
        });
      });

      await this.mfaService.clearPendingSetup(session.id);
    }

    const sessionWithMfa = await this.sessionsService.completeMfaChallenge(session.id, sessionMfaLevel);
    if (!sessionWithMfa) {
      throw new UnauthorizedException('Current session is not valid');
    }

    const updatedSession = await this.sessionsService.markReauthenticated(session.id);
    if (!updatedSession) {
      throw new UnauthorizedException('Current session is not valid');
    }

    return {
      session: updatedSession,
      recoveryCodes,
      remainingRecoveryCodes,
    };
  }

  async regenerateRecoveryCodes(
    session: ActiveSession,
    metadata: RequestMetadata,
  ): Promise<RecoveryCodesResult> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
      },
    });

    if (!user || !user.mfaEnabled || !user.mfaTotpSecretEnc) {
      throw new ConflictException('MFA must be enabled before regenerating recovery codes');
    }

    const generatedRecoveryCodes = this.mfaService.generateRecoveryCodes();

    await this.prismaService.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaRecoveryCodes: generatedRecoveryCodes.hashes,
          mfaRecoveryCodesGeneratedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.mfa.recovery_codes.regenerated',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'session',
          entityId: session.id,
          metadata: {
            count: generatedRecoveryCodes.codes.length,
          },
        }),
      });
    });

    return {
      recoveryCodes: generatedRecoveryCodes.codes,
      remainingRecoveryCodes: generatedRecoveryCodes.codes.length,
    };
  }

  async disableMfa(
    session: ActiveSession,
    payload: MfaDisableDto,
    metadata: RequestMetadata,
  ): Promise<ActiveSession> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
        mfaRecoveryCodes: true,
        mfaRecoveryCodesGeneratedAt: true,
      },
    });

    if (!user || !user.mfaEnabled) {
      throw new ConflictException('MFA is not enabled for this account');
    }

    const previousMfaState = this.getMfaStateSnapshot(user);

    await this.prismaService.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: this.getMfaDisabledData(),
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.mfa.disabled',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'session',
          entityId: session.id,
          metadata: {
            reason: payload.reason,
          },
        }),
      });
    });

    try {
      await this.sessionsService.revokeAllSessions(user.id, 'mfa-disabled', session.id);
      const updatedSession = await this.sessionsService.completeMfaChallenge(session.id, 'none');

      if (!updatedSession) {
        throw new UnauthorizedException('Current session is not valid');
      }

      return updatedSession;
    } catch (error) {
      await this.rollbackMfaState(
        user.id,
        user.id,
        previousMfaState,
        'auth.mfa.disabled.rollback',
        metadata,
        {
          reason: payload.reason,
          rollbackReason: 'session-enforcement-failed',
        },
      );
      throw error;
    }
  }

  async adminResetMfa(
    session: ActiveSession,
    payload: MfaAdminResetDto,
    metadata: RequestMetadata,
  ): Promise<void> {
    const roles = await this.getUserRoles(session.userId);
    const allowed = roles.some((role) => this.adminResetRoles.includes(role));

    if (!allowed) {
      await this.auditService.record({
        action: 'auth.mfa.admin_reset.denied',
        result: 'DENIED',
        userId: session.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        entityType: 'user',
        entityId: payload.userId,
        metadata: {
          reason: 'insufficient-role',
          roles,
        },
      });
      throw new ForbiddenException('Insufficient permissions to reset MFA for another user');
    }

    const targetUser = await this.prismaService.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
        mfaRecoveryCodes: true,
        mfaRecoveryCodesGeneratedAt: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const previousMfaState = this.getMfaStateSnapshot(targetUser);

    await this.prismaService.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: payload.userId },
        data: this.getMfaDisabledData(),
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.mfa.admin_reset.success',
          result: 'SUCCESS',
          userId: session.userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'user',
          entityId: payload.userId,
          metadata: {
            reason: payload.reason,
          },
        }),
      });
    });

    try {
      if (payload.userId === session.userId) {
        await this.sessionsService.revokeAllSessions(payload.userId, 'mfa-admin-reset', session.id);
        const updatedSession = await this.sessionsService.completeMfaChallenge(session.id, 'none');
        if (!updatedSession) {
          throw new UnauthorizedException('Current session is not valid');
        }
        return;
      }

      await this.sessionsService.revokeAllSessions(payload.userId, 'mfa-admin-reset');
    } catch (error) {
      await this.rollbackMfaState(
        session.userId,
        payload.userId,
        previousMfaState,
        'auth.mfa.admin_reset.rollback',
        metadata,
        {
          reason: payload.reason,
          rollbackReason: 'session-enforcement-failed',
        },
      );
      throw error;
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getMfaDisabledData() {
    return {
      mfaEnabled: false,
      mfaTotpSecretEnc: null,
      mfaRecoveryCodes: [],
      mfaRecoveryCodesGeneratedAt: null,
    };
  }

  private getMfaStateSnapshot(state: UserMfaStateSnapshot): UserMfaStateSnapshot {
    return {
      mfaEnabled: state.mfaEnabled,
      mfaTotpSecretEnc: state.mfaTotpSecretEnc,
      mfaRecoveryCodes: [...state.mfaRecoveryCodes],
      mfaRecoveryCodesGeneratedAt: state.mfaRecoveryCodesGeneratedAt,
    };
  }

  private getMfaStateData(snapshot: UserMfaStateSnapshot) {
    return {
      mfaEnabled: snapshot.mfaEnabled,
      mfaTotpSecretEnc: snapshot.mfaTotpSecretEnc,
      mfaRecoveryCodes: [...snapshot.mfaRecoveryCodes],
      mfaRecoveryCodesGeneratedAt: snapshot.mfaRecoveryCodesGeneratedAt,
    };
  }

  private async rollbackMfaState(
    actorUserId: string,
    targetUserId: string,
    snapshot: UserMfaStateSnapshot,
    action: 'auth.mfa.disabled.rollback' | 'auth.mfa.admin_reset.rollback',
    metadata: RequestMetadata,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prismaService.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetUserId },
          data: this.getMfaStateData(snapshot),
        });

        await tx.auditEvent.create({
          data: this.auditService.buildCreateData({
            action,
            result: 'SUCCESS',
            userId: actorUserId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            entityType: 'user',
            entityId: targetUserId,
            metadata: extraMetadata,
          }),
        });
      });
    } catch {
      throw new ServiceUnavailableException(
        'Failed to restore MFA state after session enforcement error',
      );
    }
  }

  private async getUserRoles(userId: string): Promise<UserRole[]> {
    const assignments = await this.prismaService.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });

    return assignments.map((assignment) => assignment.role);
  }

  private async registerFailedLogin(userId: string, currentFailedCount: number): Promise<void> {
    const nextFailedCount = currentFailedCount + 1;
    const maxFailedAttempts = this.getNumberConfig('app.auth.maxFailedAttempts', 5);

    await this.prismaService.passwordCredential.update({
      where: { userId },
      data:
        nextFailedCount >= maxFailedAttempts
          ? {
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + this.getLockoutMs()),
            }
          : {
              failedLoginCount: nextFailedCount,
            },
    });
  }

  private async resetFailedLogin(userId: string): Promise<void> {
    await this.prismaService.passwordCredential.update({
      where: { userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  private getLockoutMs(): number {
    const minutes = this.getNumberConfig('app.auth.lockoutMinutes', 15);
    return minutes * 60_000;
  }

  private getNumberConfig(
    path: 'app.auth.maxFailedAttempts' | 'app.auth.lockoutMinutes',
    fallback: number,
  ): number {
    return this.configService.get<number>(path, { infer: true }) ?? fallback;
  }

  private invalidCredentialsError(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials');
  }

  private isTooManyRequestsError(error: unknown): boolean {
    return error instanceof HttpException && error.getStatus() === 429;
  }

  private async assertLoginAllowed(email: string, metadata: RequestMetadata): Promise<void> {
    try {
      await this.authRateLimitService.assertLoginAllowed(email, metadata.ipAddress);
    } catch (error) {
      if (this.isTooManyRequestsError(error)) {
        await this.auditService.record({
          action: 'auth.login.rate_limited',
          result: 'DENIED',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: {
            email,
          },
        });
      }

      throw error;
    }
  }

  private async assertReauthenticationAllowed(
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    try {
      await this.authRateLimitService.assertReauthenticationAllowed(userId, metadata.ipAddress);
    } catch (error) {
      if (this.isTooManyRequestsError(error)) {
        await this.auditService.record({
          action: 'auth.reauthenticate.rate_limited',
          result: 'DENIED',
          userId,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'user',
          entityId: userId,
        });
      }

      throw error;
    }
  }

  private async auditFailure(
    action: string,
    metadata: RequestMetadata,
    userId?: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      action,
      result: 'FAILURE',
      userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: extraMetadata,
    });
  }
}

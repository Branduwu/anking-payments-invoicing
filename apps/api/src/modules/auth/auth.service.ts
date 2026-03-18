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
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus, type WebAuthnCredential } from '@prisma/client';
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
import {
  WebAuthnService,
  type StoredWebAuthnCredential,
  type WebAuthnAuthenticationPurpose,
} from './webauthn.service';

export type AvailableMfaMethod = 'totp' | 'recovery_code' | 'webauthn';

interface LoginResult {
  sessionId: string;
  mfaRequired: boolean;
  availableMfaMethods: AvailableMfaMethod[];
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
  activeWebAuthnCredentialIds: string[];
}

interface WebAuthnCredentialView {
  id: string;
  createdAt: Date;
  lastUsedAt?: Date;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
}

interface WebAuthnRegistrationResult {
  credentialId: string;
  recoveryCodes?: string[];
  remainingRecoveryCodes: number;
  totalCredentials: number;
}

interface WebAuthnAuthenticationResult {
  session: ActiveSession;
  purpose: WebAuthnAuthenticationPurpose;
}

interface UserMfaState {
  mfaEnabled: boolean;
  mfaTotpSecretEnc: string | null;
  mfaRecoveryCodes: string[];
  mfaRecoveryCodesGeneratedAt: Date | null;
  webauthnCredentials: Pick<WebAuthnCredential, 'id'>[];
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
    private readonly webAuthnService: WebAuthnService,
  ) {}

  async login(payload: LoginDto, metadata: RequestMetadata): Promise<LoginResult> {
    const email = this.normalizeEmail(payload.email);
    await this.assertLoginAllowed(email, metadata);
    const user = await this.prismaService.user.findUnique({
      where: { email },
      include: {
        credentials: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
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

    const availableMfaMethods = this.resolveAvailableMfaMethods({
      mfaTotpSecretEnc: user.mfaTotpSecretEnc,
      mfaRecoveryCodes: user.mfaRecoveryCodes,
      activeWebAuthnCredentialCount: user.webauthnCredentials.length,
    });
    const mfaRequired = availableMfaMethods.length > 0;

    const session = await this.sessionsService.createSession(user.id, metadata, 'none', mfaRequired);

    if (!mfaRequired) {
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
        mfaRequired,
        availableMfaMethods,
      },
    });

    return {
      sessionId: session.id,
      mfaRequired,
      availableMfaMethods,
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
      webauthnCredentialsCount: number;
      mfaMethods: AvailableMfaMethod[];
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });

    const mfaMethods = this.resolveAvailableMfaMethods({
      mfaTotpSecretEnc: user.mfaTotpSecretEnc,
      mfaRecoveryCodes: user.mfaRecoveryCodes,
      activeWebAuthnCredentialCount: user.webauthnCredentials.length,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        mfaEnabled: mfaMethods.length > 0,
        roles: user.roles.map((role) => role.role),
        recoveryCodesRemaining: user.mfaRecoveryCodes.length,
        webauthnCredentialsCount: user.webauthnCredentials.length,
        mfaMethods,
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
        mfaTotpSecretEnc: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    if (user.mfaTotpSecretEnc) {
      throw new ConflictException('TOTP MFA is already enabled for this account');
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
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

    if (
      this.resolveAvailableMfaMethods({
        mfaTotpSecretEnc: user.mfaTotpSecretEnc,
        mfaRecoveryCodes: user.mfaRecoveryCodes,
        activeWebAuthnCredentialCount: user.webauthnCredentials.length,
      }).length > 0
    ) {
      throw new BadRequestException(
        'Use a registered MFA method for reauthentication when MFA is enabled.',
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    let recoveryCodes: string[] | undefined;
    let remainingRecoveryCodes = user.mfaRecoveryCodes.length;
    let sessionMfaLevel: MfaLevel = 'totp';
    const hasPrimaryMfaFactor = this.hasPrimaryMfaFactor(
      user.mfaTotpSecretEnc,
      user.webauthnCredentials.length,
    );

    if (payload.method === 'recovery_code') {
      if (!hasPrimaryMfaFactor || user.mfaRecoveryCodes.length === 0) {
        await this.auditFailure('auth.mfa.verify.failure', metadata, user.id, {
          reason: 'recovery-code-unavailable',
        });
        throw new BadRequestException('Recovery codes are not configured for this account');
      }

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
    } else if (user.mfaEnabled && user.mfaTotpSecretEnc) {
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
    } else if (user.mfaEnabled && hasPrimaryMfaFactor) {
      await this.auditFailure('auth.mfa.verify.failure', metadata, user.id, {
        reason: 'totp-not-configured',
      });
      throw new BadRequestException('TOTP is not configured for this account');
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new ConflictException('MFA must be enabled before regenerating recovery codes');
    }

    if (!this.hasPrimaryMfaFactor(user.mfaTotpSecretEnc, user.webauthnCredentials.length)) {
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
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
      await tx.webAuthnCredential.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
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
            revokedWebAuthnCredentials: user.webauthnCredentials.length,
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
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
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
      await tx.webAuthnCredential.updateMany({
        where: {
          userId: payload.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
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
            revokedWebAuthnCredentials: targetUser.webauthnCredentials.length,
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

  async beginWebAuthnRegistration(
    session: ActiveSession,
    requestOrigin?: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            id: true,
            credentialId: true,
            publicKey: true,
            counter: true,
            transports: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    return this.webAuthnService.beginRegistration(
      session.id,
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      user.webauthnCredentials.map((credential) => this.toStoredWebAuthnCredential(credential)),
      requestOrigin,
    );
  }

  async finishWebAuthnRegistration(
    session: ActiveSession,
    response: RegistrationResponseJSON,
    metadata: RequestMetadata,
    requestOrigin?: string,
  ): Promise<WebAuthnRegistrationResult> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
        mfaRecoveryCodes: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            id: true,
            credentialId: true,
            publicKey: true,
            counter: true,
            transports: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

      let verification: Awaited<ReturnType<WebAuthnService['finishRegistration']>>;
      try {
        verification = await this.webAuthnService.finishRegistration(session.id, response, requestOrigin);
      } catch (error) {
      await this.auditFailure('auth.webauthn.registration.failure', metadata, user.id, {
        reason: error instanceof Error ? error.message : 'challenge-or-verification-error',
      });
      throw error;
    }

    if (!verification.verified || !verification.registrationInfo) {
      await this.auditFailure('auth.webauthn.registration.failure', metadata, user.id, {
        reason: 'verification-failed',
      });
      throw this.invalidCredentialsError();
    }

    const credentialId = verification.registrationInfo.credential.id;
    if (user.webauthnCredentials.some((credential) => credential.credentialId === credentialId)) {
      throw new ConflictException('This WebAuthn credential is already registered');
    }

    const shouldGenerateRecoveryCodes = user.mfaRecoveryCodes.length === 0;
    const recoveryCodes = shouldGenerateRecoveryCodes ? this.mfaService.generateRecoveryCodes() : null;

    await this.prismaService.$transaction(async (tx) => {
      await tx.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId,
          publicKey: Buffer.from(verification.registrationInfo.credential.publicKey),
          counter: verification.registrationInfo.credential.counter,
          transports: response.response.transports ?? [],
          deviceType: verification.registrationInfo.credentialDeviceType,
          backedUp: verification.registrationInfo.credentialBackedUp,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          ...(recoveryCodes
            ? {
                mfaRecoveryCodes: recoveryCodes.hashes,
                mfaRecoveryCodesGeneratedAt: new Date(),
              }
            : {}),
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.webauthn.registration.success',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'webauthn_credential',
          entityId: credentialId,
          metadata: {
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            generatedRecoveryCodes: recoveryCodes?.codes.length ?? 0,
          },
        }),
      });
    });

    return {
      credentialId,
      recoveryCodes: recoveryCodes?.codes,
      remainingRecoveryCodes: recoveryCodes?.codes.length ?? user.mfaRecoveryCodes.length,
      totalCredentials: user.webauthnCredentials.length + 1,
    };
  }

  async beginWebAuthnAuthentication(
    session: ActiveSession,
    purpose?: WebAuthnAuthenticationPurpose,
    requestOrigin?: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const resolvedPurpose = this.resolveWebAuthnAuthenticationPurpose(session, purpose);
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            id: true,
            credentialId: true,
            publicKey: true,
            counter: true,
            transports: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

      return this.webAuthnService.beginAuthentication(
        session.id,
        resolvedPurpose,
        user.webauthnCredentials.map((credential) => this.toStoredWebAuthnCredential(credential)),
        requestOrigin,
      );
    }

  async finishWebAuthnAuthentication(
    session: ActiveSession,
    response: AuthenticationResponseJSON,
    metadata: RequestMetadata,
    purpose?: WebAuthnAuthenticationPurpose,
    requestOrigin?: string,
  ): Promise<WebAuthnAuthenticationResult> {
    const resolvedPurpose = this.resolveWebAuthnAuthenticationPurpose(session, purpose);
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            id: true,
            credentialId: true,
            publicKey: true,
            counter: true,
            transports: true,
            deviceType: true,
            backedUp: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    const credential = user.webauthnCredentials.find(
      (candidate) => candidate.credentialId === response.id,
    );

    if (!credential) {
      await this.auditFailure('auth.webauthn.authentication.failure', metadata, user.id, {
        reason: 'credential-not-found',
        purpose: resolvedPurpose,
      });
      throw this.invalidCredentialsError();
    }

    let verification: Awaited<ReturnType<WebAuthnService['finishAuthentication']>>;
    try {
        verification = await this.webAuthnService.finishAuthentication(
          session.id,
          resolvedPurpose,
          response,
          this.toStoredWebAuthnCredential(credential),
          requestOrigin,
        );
      } catch (error) {
      await this.auditFailure('auth.webauthn.authentication.failure', metadata, user.id, {
        reason: error instanceof Error ? error.message : 'challenge-or-verification-error',
        purpose: resolvedPurpose,
        credentialId: credential.credentialId,
      });
      throw error;
    }

    if (!verification.verified) {
      await this.auditFailure('auth.webauthn.authentication.failure', metadata, user.id, {
        reason: 'verification-failed',
        purpose: resolvedPurpose,
        credentialId: credential.credentialId,
      });
      throw this.invalidCredentialsError();
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.webAuthnCredential.update({
        where: { id: credential.id },
        data: {
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
          deviceType: verification.authenticationInfo.credentialDeviceType,
          backedUp: verification.authenticationInfo.credentialBackedUp,
        },
      });

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.webauthn.authentication.success',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'webauthn_credential',
          entityId: credential.credentialId,
          metadata: {
            purpose: resolvedPurpose,
            deviceType: verification.authenticationInfo.credentialDeviceType,
            backedUp: verification.authenticationInfo.credentialBackedUp,
          },
        }),
      });
    });

    const sessionWithMfa = await this.sessionsService.completeMfaChallenge(session.id, 'webauthn');
    if (!sessionWithMfa) {
      throw new UnauthorizedException('Current session is not valid');
    }

    const updatedSession = await this.sessionsService.markReauthenticated(session.id);
    if (!updatedSession) {
      throw new UnauthorizedException('Current session is not valid');
    }

    return {
      session: updatedSession,
      purpose: resolvedPurpose,
    };
  }

  async listWebAuthnCredentials(session: ActiveSession): Promise<WebAuthnCredentialView[]> {
    const credentials = await this.prismaService.webAuthnCredential.findMany({
      where: {
        userId: session.userId,
        revokedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        deviceType: true,
        backedUp: true,
        transports: true,
      },
    });

    return credentials.map((credential) => ({
      ...credential,
      lastUsedAt: credential.lastUsedAt ?? undefined,
    }));
  }

  async revokeWebAuthnCredential(
    session: ActiveSession,
    credentialId: string,
    metadata: RequestMetadata,
  ): Promise<{ remainingCredentials: number; mfaEnabled: boolean }> {
    const user = await this.prismaService.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        mfaEnabled: true,
        mfaTotpSecretEnc: true,
        mfaRecoveryCodes: true,
        mfaRecoveryCodesGeneratedAt: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Current user not found');
    }

    const targetCredential = user.webauthnCredentials.find((credential) => credential.id === credentialId);
    if (!targetCredential) {
      throw new NotFoundException('WebAuthn credential not found');
    }

    const remainingCredentials = user.webauthnCredentials.length - 1;
    const hasRemainingPrimaryFactor = this.hasPrimaryMfaFactor(
      user.mfaTotpSecretEnc,
      remainingCredentials,
    );
    const previousMfaState = this.getMfaStateSnapshot(user);

    await this.prismaService.$transaction(async (tx) => {
      await tx.webAuthnCredential.update({
        where: { id: credentialId },
        data: {
          revokedAt: new Date(),
        },
      });

      if (!hasRemainingPrimaryFactor) {
        await tx.user.update({
          where: { id: user.id },
          data: this.getMfaDisabledData(),
        });
      }

      await tx.auditEvent.create({
        data: this.auditService.buildCreateData({
          action: 'auth.webauthn.credential.revoked',
          result: 'SUCCESS',
          userId: user.id,
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          entityType: 'webauthn_credential',
          entityId: credentialId,
          metadata: {
            remainingCredentials,
            mfaEnabled: hasRemainingPrimaryFactor,
          },
        }),
      });
    });

    if (!hasRemainingPrimaryFactor) {
      try {
        await this.sessionsService.revokeAllSessions(
          user.id,
          'webauthn-last-primary-factor-revoked',
          session.id,
        );
        const updatedSession = await this.sessionsService.completeMfaChallenge(session.id, 'none');
        if (!updatedSession) {
          throw new UnauthorizedException('Current session is not valid');
        }
      } catch (error) {
        await this.rollbackMfaState(
          user.id,
          user.id,
          previousMfaState,
          'auth.webauthn.credential.revoked.rollback',
          metadata,
          {
            credentialId,
            rollbackReason: 'session-enforcement-failed',
          },
        );
        throw error;
      }
    }

    return {
      remainingCredentials,
      mfaEnabled: hasRemainingPrimaryFactor,
    };
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

  private getMfaStateSnapshot(state: UserMfaState): UserMfaStateSnapshot {
    return {
      mfaEnabled: state.mfaEnabled,
      mfaTotpSecretEnc: state.mfaTotpSecretEnc,
      mfaRecoveryCodes: [...state.mfaRecoveryCodes],
      mfaRecoveryCodesGeneratedAt: state.mfaRecoveryCodesGeneratedAt,
      activeWebAuthnCredentialIds: state.webauthnCredentials.map((credential) => credential.id),
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
    action:
      | 'auth.mfa.disabled.rollback'
      | 'auth.mfa.admin_reset.rollback'
      | 'auth.webauthn.credential.revoked.rollback',
    metadata: RequestMetadata,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prismaService.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetUserId },
          data: this.getMfaStateData(snapshot),
        });
        if (snapshot.activeWebAuthnCredentialIds.length > 0) {
          await tx.webAuthnCredential.updateMany({
            where: {
              id: {
                in: snapshot.activeWebAuthnCredentialIds,
              },
            },
            data: {
              revokedAt: null,
            },
          });
        }

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

  private resolveAvailableMfaMethods(state: {
    mfaTotpSecretEnc: string | null;
    mfaRecoveryCodes: string[];
    activeWebAuthnCredentialCount: number;
  }): AvailableMfaMethod[] {
    const methods: AvailableMfaMethod[] = [];
    const hasPrimaryFactor = this.hasPrimaryMfaFactor(
      state.mfaTotpSecretEnc,
      state.activeWebAuthnCredentialCount,
    );

    if (state.mfaTotpSecretEnc) {
      methods.push('totp');
    }

    if (state.activeWebAuthnCredentialCount > 0) {
      methods.push('webauthn');
    }

    if (hasPrimaryFactor && state.mfaRecoveryCodes.length > 0) {
      methods.push('recovery_code');
    }

    return methods;
  }

  private hasPrimaryMfaFactor(
    mfaTotpSecretEnc: string | null,
    activeWebAuthnCredentialCount: number,
  ): boolean {
    return Boolean(mfaTotpSecretEnc) || activeWebAuthnCredentialCount > 0;
  }

  private resolveWebAuthnAuthenticationPurpose(
    session: ActiveSession,
    purpose?: WebAuthnAuthenticationPurpose,
  ): WebAuthnAuthenticationPurpose {
    const resolvedPurpose = purpose ?? (session.requiresMfa ? 'login' : 'reauth');

    if (resolvedPurpose === 'login' && !session.requiresMfa) {
      throw new BadRequestException('Current session does not require MFA login completion');
    }

    if (resolvedPurpose === 'reauth' && session.requiresMfa) {
      throw new BadRequestException('Pending MFA sessions must complete login verification first');
    }

    return resolvedPurpose;
  }

  private toStoredWebAuthnCredential(
    credential: Pick<WebAuthnCredential, 'credentialId' | 'publicKey' | 'counter' | 'transports'>,
  ): StoredWebAuthnCredential {
    return {
      id: credential.credentialId,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as StoredWebAuthnCredential['transports'],
    };
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

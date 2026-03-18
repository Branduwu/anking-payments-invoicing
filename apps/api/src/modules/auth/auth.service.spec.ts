import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { verify } from 'argon2';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
}));

describe('AuthService', () => {
  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'app.auth.maxFailedAttempts') {
        return 5;
      }

      if (path === 'app.auth.lockoutMinutes') {
        return 15;
      }

      return undefined;
    }),
  };

  const prismaService = {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    webAuthnCredential: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    userRoleAssignment: {
      findMany: jest.fn(),
    },
    passwordCredential: {
      update: jest.fn(),
    },
  };

  const auditService = {
    record: jest.fn(),
    buildCreateData: jest.fn((event: unknown) => event),
  };

  const sessionsService = {
    createSession: jest.fn(),
    markReauthenticated: jest.fn(),
    revokeSession: jest.fn(),
    revokeAllSessions: jest.fn(),
    rotateSession: jest.fn(),
    completeMfaChallenge: jest.fn(),
    updateMfaLevel: jest.fn(),
  };

  const mfaService = {
    createSetup: jest.fn(),
    verifyPendingSetup: jest.fn(),
    clearPendingSetup: jest.fn(),
    verifyEncryptedSecret: jest.fn(),
    generateRecoveryCodes: jest.fn(),
    consumeRecoveryCode: jest.fn(),
  };

  const webAuthnService = {
    beginRegistration: jest.fn(),
    finishRegistration: jest.fn(),
    beginAuthentication: jest.fn(),
    finishAuthentication: jest.fn(),
  };

  const authRateLimitService = {
    assertLoginAllowed: jest.fn(),
    registerLoginFailure: jest.fn(),
    clearLoginFailures: jest.fn(),
    assertReauthenticationAllowed: jest.fn(),
    registerReauthenticationFailure: jest.fn(),
    clearReauthenticationFailures: jest.fn(),
  };

  let service: AuthService;

  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'usr_1',
    email: 'admin@example.com',
    displayName: null,
    status: UserStatus.ACTIVE,
    mfaEnabled: false,
    mfaTotpSecretEnc: null,
    mfaRecoveryCodes: [] as string[],
    mfaRecoveryCodesGeneratedAt: null,
    credentials: {
      passwordHash: 'hash',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    webauthnCredentials: [] as Array<Record<string, unknown>>,
    roles: [] as Array<{ role: UserRole }>,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authRateLimitService.assertLoginAllowed.mockResolvedValue(undefined);
    authRateLimitService.registerLoginFailure.mockResolvedValue(undefined);
    authRateLimitService.clearLoginFailures.mockResolvedValue(undefined);
    authRateLimitService.assertReauthenticationAllowed.mockResolvedValue(undefined);
    authRateLimitService.registerReauthenticationFailure.mockResolvedValue(undefined);
    authRateLimitService.clearReauthenticationFailures.mockResolvedValue(undefined);
    prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        user: prismaService.user,
        webAuthnCredential: prismaService.webAuthnCredential,
        auditEvent: prismaService.auditEvent,
      }),
    );
    service = new AuthService(
      configService as never,
      prismaService as never,
      auditService as never,
      sessionsService as never,
      authRateLimitService as never,
      mfaService as never,
      webAuthnService as never,
    );
  });

  it('logs in successfully and opens a session for a valid non-MFA user', async () => {
    prismaService.user.findUnique.mockResolvedValue(buildUser());
    (verify as jest.Mock).mockResolvedValue(true);
    sessionsService.createSession.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
    });

    const result = await service.login(
      {
        email: 'ADMIN@example.com',
        password: 'super-secret-123',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(prismaService.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      include: {
        credentials: true,
        webauthnCredentials: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });
    expect(authRateLimitService.assertLoginAllowed).toHaveBeenCalledWith(
      'admin@example.com',
      '127.0.0.1',
    );
    expect(authRateLimitService.clearLoginFailures).toHaveBeenCalledWith(
      'admin@example.com',
      '127.0.0.1',
    );
    expect(sessionsService.createSession).toHaveBeenCalledWith(
      'usr_1',
      expect.objectContaining({
        requestId: 'req_1',
      }),
      'none',
      false,
    );
    expect(sessionsService.markReauthenticated).toHaveBeenCalledWith('sess_1');
    expect(result).toEqual({
      sessionId: 'sess_1',
      mfaRequired: false,
      availableMfaMethods: [],
    });
  });

  it('rejects invalid credentials and increments failed logins', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
      credentials: {
        passwordHash: 'hash',
        failedLoginCount: 1,
        lockedUntil: null,
      },
      }),
    );
    (verify as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login(
        {
          email: 'admin@example.com',
          password: 'bad-password',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prismaService.passwordCredential.update).toHaveBeenCalled();
    expect(authRateLimitService.registerLoginFailure).toHaveBeenCalledWith(
      'admin@example.com',
      '127.0.0.1',
    );
  });

  it('blocks login attempts once the auth rate limit is exceeded', async () => {
    authRateLimitService.assertLoginAllowed.mockRejectedValue(
      new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS),
    );

    await expect(
      service.login(
        {
          email: 'admin@example.com',
          password: 'super-secret-123',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.rate_limited',
        result: 'DENIED',
      }),
    );
  });

  it('requires WebAuthn MFA during login when the user has active passkeys', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    (verify as jest.Mock).mockResolvedValue(true);
    sessionsService.createSession.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
    });

    const result = await service.login(
      {
        email: 'admin@example.com',
        password: 'super-secret-123',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(sessionsService.createSession).toHaveBeenCalledWith(
      'usr_1',
      expect.objectContaining({
        requestId: 'req_1',
      }),
      'none',
      true,
    );
    expect(result).toEqual({
      sessionId: 'sess_1',
      mfaRequired: true,
      availableMfaMethods: ['webauthn'],
    });
  });

  it('returns the current user profile with roles and recovery-code count', async () => {
    prismaService.user.findUniqueOrThrow.mockResolvedValue(buildUser({
      displayName: 'Admin',
      mfaEnabled: true,
      mfaTotpSecretEnc: 'encrypted-secret',
      mfaRecoveryCodes: ['one', 'two'],
      webauthnCredentials: [{ id: 'cred_1' }],
      roles: [{ role: UserRole.ADMIN }, { role: UserRole.SECURITY }],
    }));

    const result = await service.getMe({
      id: 'sess_1',
      userId: 'usr_1',
      status: 'active',
      mfaLevel: 'none',
      createdAt: new Date('2026-03-16T00:00:00.000Z'),
      lastActivity: new Date('2026-03-16T00:00:00.000Z'),
      expiresAt: new Date('2026-03-16T00:15:00.000Z'),
      absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
    });

    expect(result.user.roles).toEqual([UserRole.ADMIN, UserRole.SECURITY]);
    expect(result.user.recoveryCodesRemaining).toBe(2);
    expect(result.user.mfaMethods).toEqual(['totp', 'webauthn', 'recovery_code']);
  });

  it('redirects password reauthentication to MFA verification when MFA is enabled', async () => {
    prismaService.user.findUnique.mockResolvedValue(buildUser({
      mfaEnabled: true,
      mfaTotpSecretEnc: 'encrypted-secret',
      credentials: {
        passwordHash: 'hash',
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }));

    await expect(
      service.reauthenticate(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          password: 'super-secret-123',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(authRateLimitService.assertReauthenticationAllowed).toHaveBeenCalledWith(
      'usr_1',
      '127.0.0.1',
    );
  });

  it('blocks reauthentication attempts once the auth rate limit is exceeded', async () => {
    authRateLimitService.assertReauthenticationAllowed.mockRejectedValue(
      new HttpException(
        'Too many reauthentication attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await expect(
      service.reauthenticate(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          password: 'super-secret-123',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.rate_limited',
        result: 'DENIED',
        userId: 'usr_1',
      }),
    );
  });

  it('creates an MFA setup for a valid user without MFA enabled', async () => {
    prismaService.user.findUnique.mockResolvedValue(buildUser());
    mfaService.createSetup.mockResolvedValue({
      secret: 'SECRET',
      otpauthUrl: 'otpauth://totp/demo',
      issuer: 'banking-platform-api',
      accountName: 'admin@example.com',
      expiresInSeconds: 600,
    });

    const result = await service.setupMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(mfaService.createSetup).toHaveBeenCalledWith('sess_1', 'admin@example.com');
    expect(result.secret).toBe('SECRET');
  });

  it('rejects MFA setup if MFA is already enabled', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
      }),
    );

    await expect(
      service.setupMfa(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'none',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enables MFA and returns recovery codes when pending setup verification succeeds', async () => {
    prismaService.user.findUnique.mockResolvedValue(buildUser());
    mfaService.verifyPendingSetup.mockResolvedValue('encrypted-secret');
    mfaService.generateRecoveryCodes.mockReturnValue({
      codes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'],
      hashes: ['hash1', 'hash2'],
    });
    sessionsService.updateMfaLevel.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'totp',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    });

    const result = await service.verifyMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        code: '123456',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(mfaService.clearPendingSetup).toHaveBeenCalledWith('sess_1');
    expect(sessionsService.updateMfaLevel).toHaveBeenCalledWith('sess_1', 'totp');
    expect(result.recoveryCodes).toEqual(['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH']);
    expect(result.remainingRecoveryCodes).toBe(2);
    expect(result.session.reauthenticatedUntil).toBeInstanceOf(Date);
    expect(result.purpose).toBe('reauth');
  });

  it('accepts a recovery code and downgrades the remaining recovery-code count', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1', 'hash2'],
      }),
    );
    mfaService.consumeRecoveryCode.mockResolvedValue({
      matched: true,
      remainingHashes: ['hash2'],
    });
    sessionsService.updateMfaLevel.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'recovery',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    });

    const result = await service.verifyMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        code: 'AAAA-BBBB-CCCC-DDDD',
        method: 'recovery_code',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(mfaService.consumeRecoveryCode).toHaveBeenCalledWith(
      ['hash1', 'hash2'],
      'AAAA-BBBB-CCCC-DDDD',
      {
        scope: 'recovery',
        actorId: 'usr_1',
      },
    );
    expect(sessionsService.updateMfaLevel).toHaveBeenCalledWith('sess_1', 'recovery');
    expect(result.remainingRecoveryCodes).toBe(1);
    expect(result.purpose).toBe('reauth');
  });

  it('accepts recovery codes when WebAuthn is the only primary MFA factor', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: ['hash1', 'hash2'],
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    mfaService.consumeRecoveryCode.mockResolvedValue({
      matched: true,
      remainingHashes: ['hash1'],
    });
    sessionsService.completeMfaChallenge.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'recovery',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    });

    const result = await service.verifyMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        requiresMfa: true,
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        code: 'AAAA-BBBB-CCCC-DDDD',
        method: 'recovery_code',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(mfaService.consumeRecoveryCode).toHaveBeenCalledWith(
      ['hash1', 'hash2'],
      'AAAA-BBBB-CCCC-DDDD',
      {
        scope: 'recovery',
        actorId: 'usr_1',
      },
    );
    expect(mfaService.verifyPendingSetup).not.toHaveBeenCalled();
    expect(result.remainingRecoveryCodes).toBe(1);
    expect(result.purpose).toBe('login');
  });

  it('allows TOTP-only accounts to reauthenticate via mfa verification', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
      }),
    );
    mfaService.verifyEncryptedSecret.mockResolvedValue(true);
    sessionsService.updateMfaLevel.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'totp',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'totp',
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    });

    const result = await service.verifyMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        requiresMfa: false,
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        code: '123456',
        method: 'totp',
        purpose: 'reauth',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(mfaService.verifyEncryptedSecret).toHaveBeenCalledWith(
      'encrypted-secret',
      '123456',
      {
        scope: 'totp',
        actorId: 'usr_1',
      },
    );
    expect(authRateLimitService.assertReauthenticationAllowed).toHaveBeenCalledWith(
      'usr_1',
      '127.0.0.1',
    );
    expect(authRateLimitService.clearReauthenticationFailures).toHaveBeenCalledWith(
      'usr_1',
      '127.0.0.1',
    );
    expect(sessionsService.updateMfaLevel).toHaveBeenCalledWith('sess_1', 'totp');
    expect(sessionsService.completeMfaChallenge).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.success',
        result: 'SUCCESS',
        userId: 'usr_1',
        metadata: expect.objectContaining({
          via: 'mfa',
          mfaLevel: 'totp',
        }),
      }),
    );
    expect(result.purpose).toBe('reauth');
    expect(result.session.reauthenticatedUntil).toBeInstanceOf(Date);
  });

  it('blocks MFA-based reauthentication attempts once the auth rate limit is exceeded', async () => {
    authRateLimitService.assertReauthenticationAllowed.mockRejectedValue(
      new HttpException(
        'Too many reauthentication attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await expect(
      service.verifyMfa(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          requiresMfa: false,
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          code: '123456',
          method: 'totp',
          purpose: 'reauth',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(mfaService.verifyEncryptedSecret).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.rate_limited',
        result: 'DENIED',
        userId: 'usr_1',
      }),
    );
  });

  it('registers reauthentication failures when TOTP reauthentication code is invalid', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
      }),
    );
    mfaService.verifyEncryptedSecret.mockResolvedValue(false);

    await expect(
      service.verifyMfa(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          requiresMfa: false,
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          code: '000000',
          method: 'totp',
          purpose: 'reauth',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(authRateLimitService.registerReauthenticationFailure).toHaveBeenCalledWith(
      'usr_1',
      '127.0.0.1',
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.reauthenticate.failure',
        result: 'FAILURE',
        userId: 'usr_1',
        metadata: expect.objectContaining({
          reason: 'invalid-totp-code',
          via: 'mfa',
        }),
      }),
    );
  });

  it('regenerates recovery codes for a user with MFA enabled', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
      }),
    );
    mfaService.generateRecoveryCodes.mockReturnValue({
      codes: ['AAAA-BBBB-CCCC-DDDD'],
      hashes: ['hash1'],
    });

    const result = await service.regenerateRecoveryCodes(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(result.recoveryCodes).toEqual(['AAAA-BBBB-CCCC-DDDD']);
    expect(result.remainingRecoveryCodes).toBe(1);
  });

  it('registers a WebAuthn credential and generates recovery codes on first enrollment', async () => {
    prismaService.user.findUnique.mockResolvedValue(buildUser());
    mfaService.generateRecoveryCodes.mockReturnValue({
      codes: ['AAAA-BBBB-CCCC-DDDD'],
      hashes: ['hash1'],
    });
    webAuthnService.finishRegistration.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'webauthn_1',
          publicKey: Buffer.from('public-key'),
          counter: 0,
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });

    const result = await service.finishWebAuthnRegistration(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        id: 'webauthn_1',
        rawId: 'webauthn_1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client',
          attestationObject: 'attestation',
          transports: ['internal'],
        },
        clientExtensionResults: {},
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(webAuthnService.finishRegistration).toHaveBeenCalledWith(
      'sess_1',
      expect.any(Object),
      undefined,
    );
    expect(prismaService.webAuthnCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'usr_1',
        credentialId: 'webauthn_1',
      }),
    });
    expect(result).toEqual({
      credentialId: 'webauthn_1',
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      remainingRecoveryCodes: 1,
      totalCredentials: 1,
    });
  });

  it('verifies WebAuthn authentication and marks the session as reauthenticated', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        webauthnCredentials: [
          {
            id: 'cred_1',
            credentialId: 'webauthn_1',
            publicKey: Buffer.from('public-key'),
            counter: 1,
            transports: ['internal'],
            deviceType: 'multiDevice',
            backedUp: true,
          },
        ],
      }),
    );
    webAuthnService.finishAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'webauthn_1',
        newCounter: 2,
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    });
    sessionsService.completeMfaChallenge.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'webauthn',
    });
    sessionsService.markReauthenticated.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'webauthn',
      reauthenticatedUntil: new Date('2026-03-16T00:05:00.000Z'),
    });

    const result = await service.finishWebAuthnAuthentication(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'none',
        requiresMfa: true,
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        id: 'webauthn_1',
        rawId: 'webauthn_1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
      'login',
    );

    expect(webAuthnService.finishAuthentication).toHaveBeenCalledWith(
      'sess_1',
      'login',
      expect.any(Object),
      expect.objectContaining({
        credentialId: 'webauthn_1',
      }),
      undefined,
    );
    expect(sessionsService.completeMfaChallenge).toHaveBeenCalledWith('sess_1', 'webauthn');
    expect(result.purpose).toBe('login');
    expect(result.session.reauthenticatedUntil).toBeInstanceOf(Date);
  });

  it('disables MFA and revokes other sessions', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: new Date('2026-03-16T00:00:00.000Z'),
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    sessionsService.revokeAllSessions.mockResolvedValue(2);
    sessionsService.completeMfaChallenge.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'none',
    });

    const result = await service.disableMfa(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'totp',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      {
        reason: 'Rotacion de dispositivo',
      },
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(sessionsService.revokeAllSessions).toHaveBeenCalledWith(
      'usr_1',
      'mfa-disabled',
      'sess_1',
    );
    expect(result.mfaLevel).toBe('none');
  });

  it('restores the previous MFA state when disabling MFA fails during session enforcement', async () => {
    const generatedAt = new Date('2026-03-16T00:00:00.000Z');
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    sessionsService.revokeAllSessions.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.disableMfa(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          reason: 'Rotacion de dispositivo',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toThrow('redis unavailable');

    expect(prismaService.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'usr_1' },
      data: {
        mfaEnabled: false,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: [],
        mfaRecoveryCodesGeneratedAt: null,
      },
    });
    expect(prismaService.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'usr_1' },
      data: {
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
      },
    });
    expect(prismaService.auditEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        action: 'auth.mfa.disabled.rollback',
        result: 'SUCCESS',
        userId: 'usr_1',
        entityId: 'usr_1',
      }),
    });
  });

  it('denies admin MFA reset without a privileged role', async () => {
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.OPERATOR }]);

    await expect(
      service.adminResetMfa(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          userId: 'usr_2',
          reason: 'Incidente',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restores the target MFA state when admin reset fails during session enforcement', async () => {
    const generatedAt = new Date('2026-03-16T00:00:00.000Z');
    prismaService.userRoleAssignment.findMany.mockResolvedValue([{ role: UserRole.ADMIN }]);
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        id: 'usr_2',
        email: 'other@example.com',
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
        webauthnCredentials: [{ id: 'cred_2' }],
      }),
    );
    sessionsService.revokeAllSessions.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.adminResetMfa(
        {
          id: 'sess_1',
          userId: 'usr_admin',
          status: 'active',
          mfaLevel: 'totp',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        {
          userId: 'usr_2',
          reason: 'Incidente',
        },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toThrow('redis unavailable');

    expect(prismaService.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'usr_2' },
      data: {
        mfaEnabled: false,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: [],
        mfaRecoveryCodesGeneratedAt: null,
      },
    });
    expect(prismaService.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'usr_2' },
      data: {
        mfaEnabled: true,
        mfaTotpSecretEnc: 'encrypted-secret',
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
      },
    });
    expect(prismaService.auditEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        action: 'auth.mfa.admin_reset.rollback',
        result: 'SUCCESS',
        userId: 'usr_admin',
        entityId: 'usr_2',
      }),
    });
  });

  it('revokes other sessions and disables MFA when the last WebAuthn primary factor is removed', async () => {
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: new Date('2026-03-16T00:00:00.000Z'),
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    sessionsService.revokeAllSessions.mockResolvedValue(2);
    sessionsService.completeMfaChallenge.mockResolvedValue({
      id: 'sess_1',
      userId: 'usr_1',
      mfaLevel: 'none',
    });

    const result = await service.revokeWebAuthnCredential(
      {
        id: 'sess_1',
        userId: 'usr_1',
        status: 'active',
        mfaLevel: 'webauthn',
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
        lastActivity: new Date('2026-03-16T00:00:00.000Z'),
        expiresAt: new Date('2026-03-16T00:15:00.000Z'),
        absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
      },
      'cred_1',
      {
        requestId: 'req_1',
        ipAddress: '127.0.0.1',
      },
    );

    expect(sessionsService.revokeAllSessions).toHaveBeenCalledWith(
      'usr_1',
      'webauthn-last-primary-factor-revoked',
      'sess_1',
    );
    expect(sessionsService.completeMfaChallenge).toHaveBeenCalledWith('sess_1', 'none');
    expect(result).toEqual({
      remainingCredentials: 0,
      mfaEnabled: false,
    });
  });

  it('restores the previous MFA state when revoking the last WebAuthn credential fails during session enforcement', async () => {
    const generatedAt = new Date('2026-03-16T00:00:00.000Z');
    prismaService.user.findUnique.mockResolvedValue(
      buildUser({
        mfaEnabled: true,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
        webauthnCredentials: [{ id: 'cred_1' }],
      }),
    );
    sessionsService.revokeAllSessions.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.revokeWebAuthnCredential(
        {
          id: 'sess_1',
          userId: 'usr_1',
          status: 'active',
          mfaLevel: 'webauthn',
          createdAt: new Date('2026-03-16T00:00:00.000Z'),
          lastActivity: new Date('2026-03-16T00:00:00.000Z'),
          expiresAt: new Date('2026-03-16T00:15:00.000Z'),
          absoluteExpiresAt: new Date('2026-03-16T08:00:00.000Z'),
        },
        'cred_1',
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
        },
      ),
    ).rejects.toThrow('redis unavailable');

    expect(prismaService.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'usr_1' },
      data: {
        mfaEnabled: false,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: [],
        mfaRecoveryCodesGeneratedAt: null,
      },
    });
    expect(prismaService.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'usr_1' },
      data: {
        mfaEnabled: true,
        mfaTotpSecretEnc: null,
        mfaRecoveryCodes: ['hash1'],
        mfaRecoveryCodesGeneratedAt: generatedAt,
      },
    });
    expect(prismaService.webAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['cred_1'],
        },
      },
      data: {
        revokedAt: null,
      },
    });
    expect(prismaService.auditEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        action: 'auth.webauthn.credential.revoked.rollback',
        result: 'SUCCESS',
        userId: 'usr_1',
        entityId: 'usr_1',
      }),
    });
  });
});

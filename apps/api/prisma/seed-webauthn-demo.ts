import { hash } from 'argon2';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = normalizeEmail(process.env.WEBAUTHN_DEMO_EMAIL) || 'webauthn.demo@example.com';
  const password = process.env.WEBAUTHN_DEMO_PASSWORD || 'ChangeMeNow_123456789!';
  const displayName = process.env.WEBAUTHN_DEMO_NAME?.trim() || 'WebAuthn Demo User';

  if (password.length < 12) {
    throw new Error('WEBAUTHN_DEMO_PASSWORD debe tener al menos 12 caracteres');
  }

  const passwordHash = await hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      displayName,
      status: UserStatus.ACTIVE,
      mfaEnabled: false,
      mfaTotpSecretEnc: null,
      mfaRecoveryCodes: [],
      mfaRecoveryCodesGeneratedAt: null,
    },
    create: {
      email,
      displayName,
      status: UserStatus.ACTIVE,
      mfaEnabled: false,
      mfaTotpSecretEnc: null,
      mfaRecoveryCodes: [],
      mfaRecoveryCodesGeneratedAt: null,
    },
  });

  await prisma.passwordCredential.upsert({
    where: { userId: user.id },
    update: {
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      userId: user.id,
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  await prisma.userRoleAssignment.upsert({
    where: {
      userId_role: {
        userId: user.id,
        role: UserRole.OPERATOR,
      },
    },
    update: {},
    create: {
      userId: user.id,
      role: UserRole.OPERATOR,
    },
  });

  await prisma.webAuthnCredential.deleteMany({
    where: { userId: user.id },
  });

  console.log(`WebAuthn demo user listo para ${email}`);
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

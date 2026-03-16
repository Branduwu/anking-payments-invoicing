import { hash } from 'argon2';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME?.trim() || 'Platform Admin';

  if (!email) {
    throw new Error('ADMIN_EMAIL es obligatorio para seed:admin');
  }

  if (!password || password.length < 12) {
    throw new Error('ADMIN_PASSWORD debe existir y tener al menos 12 caracteres');
  }

  const passwordHash = await hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      displayName,
      status: UserStatus.ACTIVE,
    },
    create: {
      email,
      displayName,
      status: UserStatus.ACTIVE,
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
        role: UserRole.ADMIN,
      },
    },
    update: {},
    create: {
      userId: user.id,
      role: UserRole.ADMIN,
    },
  });

  await prisma.userRoleAssignment.upsert({
    where: {
      userId_role: {
        userId: user.id,
        role: UserRole.SECURITY,
      },
    },
    update: {},
    create: {
      userId: user.id,
      role: UserRole.SECURITY,
    },
  });

  console.log(`Admin bootstrap listo para ${email}`);
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

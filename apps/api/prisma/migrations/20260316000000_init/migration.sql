-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SECURITY', 'FINANCE', 'OPERATOR', 'AUDITOR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'SETTLED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'STAMPED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaTotpSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "bankAccountRef" TEXT NOT NULL,
    "externalReference" TEXT,
    "concept" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "customerTaxId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "pacReference" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stampedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationRef" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "action" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_role_idx" ON "UserRoleAssignment"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_key" ON "UserRoleAssignment"("userId", "role");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_folio_key" ON "Invoice"("folio");

-- CreateIndex
CREATE INDEX "Invoice_userId_createdAt_idx" ON "Invoice"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_result_createdAt_idx" ON "AuditEvent"("result", "createdAt");

-- AddForeignKey
ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

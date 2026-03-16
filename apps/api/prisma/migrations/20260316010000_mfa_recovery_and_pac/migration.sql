-- AlterTable
ALTER TABLE "User"
ADD COLUMN "mfaRecoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "mfaRecoveryCodesGeneratedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice"
ADD COLUMN "pacProvider" TEXT;

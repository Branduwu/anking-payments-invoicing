ALTER TABLE "Payment"
ADD COLUMN "idempotencyKey" VARCHAR(128),
ADD COLUMN "idempotencyFingerprint" VARCHAR(128);

CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");

ALTER TABLE "Invoice"
ADD COLUMN "processingOperationId" TEXT,
ADD COLUMN "processingConfirmationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "processingErrorDetail" TEXT;

CREATE UNIQUE INDEX "Invoice_processingOperationId_key" ON "Invoice"("processingOperationId");
CREATE INDEX "Invoice_processingConfirmationRequired_processingAction_idx"
ON "Invoice"("processingConfirmationRequired", "processingAction");

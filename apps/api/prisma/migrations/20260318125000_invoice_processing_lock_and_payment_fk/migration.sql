CREATE TYPE "InvoiceProcessingAction" AS ENUM ('STAMP', 'CANCEL');

ALTER TABLE "Invoice"
ADD COLUMN "processingAction" "InvoiceProcessingAction",
ADD COLUMN "processingStartedAt" TIMESTAMP(3);

CREATE INDEX "Invoice_paymentId_idx" ON "Invoice"("paymentId");
CREATE INDEX "Invoice_processingAction_processingStartedAt_idx" ON "Invoice"("processingAction", "processingStartedAt");

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

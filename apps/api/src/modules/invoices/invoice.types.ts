export interface InvoiceView {
  id: string;
  userId: string;
  folio: string;
  status: string;
  customerTaxId: string;
  currency: string;
  subtotal: string;
  total: string;
  pacReference: string | null;
  pacProvider: string | null;
  paymentId: string | null;
  processingAction: string | null;
  processingStartedAt: Date | null;
  processingOperationId: string | null;
  processingConfirmationRequired: boolean;
  processingErrorDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
  stampedAt: Date | null;
  cancelledAt: Date | null;
  cancellationRef: string | null;
}

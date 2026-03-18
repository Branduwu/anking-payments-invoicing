export interface PaymentView {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  bankAccountRef: string;
  externalReference: string | null;
  idempotencyKey: string | null;
  concept: string | null;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
}

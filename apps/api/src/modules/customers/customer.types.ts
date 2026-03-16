import type { CustomerStatus } from '@prisma/client';

export interface CustomerView {
  id: string;
  userId: string;
  name: string;
  taxId: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerScope = 'own' | 'all';
export type CustomerSource = 'database' | 'cache';

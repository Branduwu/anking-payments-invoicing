export type SessionStatus = 'active' | 'revoked' | 'expired';
export type MfaLevel = 'none' | 'totp' | 'recovery' | 'webauthn';

export interface SessionContext {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
}

export interface ActiveSession {
  id: string;
  userId: string;
  status: SessionStatus;
  mfaLevel: MfaLevel;
  requiresMfa?: boolean;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  reauthenticatedUntil?: Date;
  ipAddress?: string;
  userAgent?: string;
  revokedReason?: string;
}

export interface MfaSetupResponseDto {
  secret: string;
  otpauthUrl: string;
  issuer: string;
  accountName: string;
  expiresInSeconds: number;
}


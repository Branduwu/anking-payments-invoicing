import { IsIn, IsObject, IsOptional } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { WebAuthnAuthenticationPurpose } from '../webauthn.service';

export class WebAuthnAuthenticationVerifyDto {
  @IsObject()
  response!: AuthenticationResponseJSON;

  @IsOptional()
  @IsIn(['login', 'reauth'])
  purpose?: WebAuthnAuthenticationPurpose;
}

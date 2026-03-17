import { IsIn, IsOptional } from 'class-validator';
import type { WebAuthnAuthenticationPurpose } from '../webauthn.service';

export class WebAuthnAuthenticationOptionsDto {
  @IsOptional()
  @IsIn(['login', 'reauth'])
  purpose?: WebAuthnAuthenticationPurpose;
}

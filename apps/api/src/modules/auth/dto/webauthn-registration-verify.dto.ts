import { IsObject } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export class WebAuthnRegistrationVerifyDto {
  @IsObject()
  response!: RegistrationResponseJSON;
}

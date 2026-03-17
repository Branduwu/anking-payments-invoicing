import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Buffer } from 'node:buffer';
import { RedisService } from '../../infrastructure/redis/redis.service';

export type WebAuthnAuthenticationPurpose = 'login' | 'reauth';

export interface StoredWebAuthnCredential {
  id: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: AuthenticatorTransportFuture[];
}

interface WebAuthnRegistrationChallengePayload {
  challenge: string;
}

interface WebAuthnAuthenticationChallengePayload {
  challenge: string;
  purpose: WebAuthnAuthenticationPurpose;
}

@Injectable()
export class WebAuthnService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async beginRegistration(
    sessionId: string,
    user: {
      id: string;
      email: string;
      displayName: string | null;
    },
    credentials: StoredWebAuthnCredential[],
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.redisService.assertAvailable();

    const options = await generateRegistrationOptions({
      rpName: this.getRpName(),
      rpID: this.getRpId(),
      userName: user.email,
      userID: Buffer.from(user.id, 'utf8'),
      userDisplayName: user.displayName ?? user.email,
      timeout: this.getTimeoutMs(),
      attestationType: 'none',
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    await this.storeRegistrationChallenge(sessionId, {
      challenge: options.challenge,
    });

    return options;
  }

  async finishRegistration(
    sessionId: string,
    response: RegistrationResponseJSON,
  ): Promise<Awaited<ReturnType<typeof verifyRegistrationResponse>>> {
    this.redisService.assertAvailable();
    const challenge = await this.consumeRegistrationChallenge(sessionId);

    return verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.getOrigins(),
      expectedRPID: this.getRpId(),
      requireUserVerification: true,
    });
  }

  async beginAuthentication(
    sessionId: string,
    purpose: WebAuthnAuthenticationPurpose,
    credentials: StoredWebAuthnCredential[],
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.redisService.assertAvailable();

    if (credentials.length === 0) {
      throw new BadRequestException('No active WebAuthn credentials are registered for this account');
    }

    const options = await generateAuthenticationOptions({
      rpID: this.getRpId(),
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      timeout: this.getTimeoutMs(),
      userVerification: 'required',
    });

    await this.storeAuthenticationChallenge(sessionId, {
      challenge: options.challenge,
      purpose,
    });

    return options;
  }

  async finishAuthentication(
    sessionId: string,
    purpose: WebAuthnAuthenticationPurpose,
    response: AuthenticationResponseJSON,
    credential: StoredWebAuthnCredential,
  ): Promise<Awaited<ReturnType<typeof verifyAuthenticationResponse>>> {
    this.redisService.assertAvailable();
    const challenge = await this.consumeAuthenticationChallenge(sessionId);

    if (challenge.purpose !== purpose) {
      throw new UnauthorizedException('Stored WebAuthn challenge purpose does not match the request');
    }

    return verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.getOrigins(),
      expectedRPID: this.getRpId(),
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
      requireUserVerification: true,
    });
  }

  private async storeRegistrationChallenge(
    sessionId: string,
    payload: WebAuthnRegistrationChallengePayload,
  ): Promise<void> {
    await this.redisService.client.set(
      this.getRegistrationChallengeKey(sessionId),
      JSON.stringify(payload),
      'EX',
      this.getChallengeTtlSeconds(),
    );
  }

  private async consumeRegistrationChallenge(
    sessionId: string,
  ): Promise<WebAuthnRegistrationChallengePayload> {
    const key = this.getRegistrationChallengeKey(sessionId);
    const payload = await this.redisService.client.get(key);
    await this.redisService.client.del(key);

    if (!payload) {
      throw new UnauthorizedException('No active WebAuthn registration challenge found');
    }

    return JSON.parse(payload) as WebAuthnRegistrationChallengePayload;
  }

  private async storeAuthenticationChallenge(
    sessionId: string,
    payload: WebAuthnAuthenticationChallengePayload,
  ): Promise<void> {
    await this.redisService.client.set(
      this.getAuthenticationChallengeKey(sessionId),
      JSON.stringify(payload),
      'EX',
      this.getChallengeTtlSeconds(),
    );
  }

  private async consumeAuthenticationChallenge(
    sessionId: string,
  ): Promise<WebAuthnAuthenticationChallengePayload> {
    const key = this.getAuthenticationChallengeKey(sessionId);
    const payload = await this.redisService.client.get(key);
    await this.redisService.client.del(key);

    if (!payload) {
      throw new UnauthorizedException('No active WebAuthn authentication challenge found');
    }

    return JSON.parse(payload) as WebAuthnAuthenticationChallengePayload;
  }

  private getRegistrationChallengeKey(sessionId: string): string {
    return `${this.getRedisPrefix()}:webauthn:registration:${sessionId}`;
  }

  private getAuthenticationChallengeKey(sessionId: string): string {
    return `${this.getRedisPrefix()}:webauthn:authentication:${sessionId}`;
  }

  private getRedisPrefix(): string {
    return this.configService.get<string>('app.data.redisKeyPrefix', { infer: true }) ?? 'platform';
  }

  private getChallengeTtlSeconds(): number {
    return Math.ceil(this.getTimeoutMs() / 1000) + 60;
  }

  private getRpName(): string {
    return (
      this.configService.get<string>('app.auth.webauthn.rpName', { infer: true }) ??
      'banking-platform-api'
    );
  }

  private getRpId(): string {
    return this.configService.get<string>('app.auth.webauthn.rpId', { infer: true }) ?? 'localhost';
  }

  private getOrigins(): string[] {
    const origins = this.configService.get<string[] | string>('app.auth.webauthn.origins', {
      infer: true,
    });

    if (Array.isArray(origins)) {
      return origins;
    }

    if (origins) {
      return [origins];
    }

    return ['http://localhost:3000', 'http://localhost:4000'];
  }

  private getTimeoutMs(): number {
    return (
      this.configService.get<number>('app.auth.webauthn.timeoutMs', { infer: true }) ?? 60_000
    );
  }
}

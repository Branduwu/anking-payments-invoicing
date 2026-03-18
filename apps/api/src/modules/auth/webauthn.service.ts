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
  origin: string;
  rpId: string;
}

interface WebAuthnAuthenticationChallengePayload {
  challenge: string;
  purpose: WebAuthnAuthenticationPurpose;
  origin: string;
  rpId: string;
}

interface WebAuthnCeremonyContext {
  origin: string;
  rpId: string;
}

@Injectable()
export class WebAuthnService {
  private static readonly consumeChallengeScript = `
    local value = redis.call('GET', KEYS[1])
    if value then
      redis.call('DEL', KEYS[1])
    end
    return value
  `;

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
    requestOrigin?: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    await this.redisService.ensureAvailable();
    const ceremonyContext = this.resolveCeremonyContext(requestOrigin);

    const options = await generateRegistrationOptions({
      rpName: this.getRpName(),
      rpID: ceremonyContext.rpId,
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
      origin: ceremonyContext.origin,
      rpId: ceremonyContext.rpId,
    });

    return options;
  }

  async finishRegistration(
    sessionId: string,
    response: RegistrationResponseJSON,
    requestOrigin?: string,
  ): Promise<Awaited<ReturnType<typeof verifyRegistrationResponse>>> {
    await this.redisService.ensureAvailable();
    const challenge = await this.consumeRegistrationChallenge(sessionId);
    this.assertMatchingOrigin(challenge.origin, requestOrigin);

    return verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
    });
  }

  async beginAuthentication(
    sessionId: string,
    purpose: WebAuthnAuthenticationPurpose,
    credentials: StoredWebAuthnCredential[],
    requestOrigin?: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    await this.redisService.ensureAvailable();
    const ceremonyContext = this.resolveCeremonyContext(requestOrigin);

    if (credentials.length === 0) {
      throw new BadRequestException('No active WebAuthn credentials are registered for this account');
    }

    const options = await generateAuthenticationOptions({
      rpID: ceremonyContext.rpId,
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
      origin: ceremonyContext.origin,
      rpId: ceremonyContext.rpId,
    });

    return options;
  }

  async finishAuthentication(
    sessionId: string,
    purpose: WebAuthnAuthenticationPurpose,
    response: AuthenticationResponseJSON,
    credential: StoredWebAuthnCredential,
    requestOrigin?: string,
  ): Promise<Awaited<ReturnType<typeof verifyAuthenticationResponse>>> {
    await this.redisService.ensureAvailable();
    const challenge = await this.consumeAuthenticationChallenge(sessionId);

    if (challenge.purpose !== purpose) {
      throw new UnauthorizedException('Stored WebAuthn challenge purpose does not match the request');
    }
    this.assertMatchingOrigin(challenge.origin, requestOrigin);

    return verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
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
    const payload = await this.consumeChallengeValue(
      key,
      'No active WebAuthn registration challenge found',
    );

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
    const payload = await this.consumeChallengeValue(
      key,
      'No active WebAuthn authentication challenge found',
    );

    return JSON.parse(payload) as WebAuthnAuthenticationChallengePayload;
  }

  private async consumeChallengeValue(key: string, missingMessage: string): Promise<string> {
    const payload = await this.redisService.client.eval(
      WebAuthnService.consumeChallengeScript,
      1,
      key,
    );
    const serializedPayload =
      typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : null;

    if (!serializedPayload) {
      throw new UnauthorizedException(missingMessage);
    }

    return serializedPayload;
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

    return [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:4000',
      'http://127.0.0.1:4000',
    ];
  }

  private getTimeoutMs(): number {
    return (
      this.configService.get<number>('app.auth.webauthn.timeoutMs', { infer: true }) ?? 60_000
    );
  }

  private resolveCeremonyContext(requestOrigin?: string): WebAuthnCeremonyContext {
    const origins = this.getOrigins().map((origin) => this.normalizeOrigin(origin)).filter(Boolean);
    const normalizedRequestOrigin = this.normalizeOrigin(requestOrigin);

    if (normalizedRequestOrigin) {
      if (!origins.includes(normalizedRequestOrigin)) {
        throw new BadRequestException('WebAuthn origin is not allowed');
      }

      return {
        origin: normalizedRequestOrigin,
        rpId: this.resolveRpIdForOrigin(normalizedRequestOrigin),
      };
    }

    const fallbackOrigin = origins[0] ?? 'http://localhost:3000';
    return {
      origin: fallbackOrigin,
      rpId: this.resolveRpIdForOrigin(fallbackOrigin),
    };
  }

  private resolveRpIdForOrigin(origin: string): string {
    const configuredRpId = this.getRpId();
    const hostname = new URL(origin).hostname;

    if (this.isLoopbackHost(configuredRpId) && this.isLoopbackHost(hostname)) {
      return hostname;
    }

    if (hostname === configuredRpId || hostname.endsWith(`.${configuredRpId}`)) {
      return configuredRpId;
    }

    throw new BadRequestException('WebAuthn origin is not compatible with the configured RP ID');
  }

  private assertMatchingOrigin(expectedOrigin: string, requestOrigin?: string): void {
    const normalizedRequestOrigin = this.normalizeOrigin(requestOrigin);
    if (normalizedRequestOrigin && normalizedRequestOrigin !== expectedOrigin) {
      throw new UnauthorizedException('WebAuthn request origin does not match the stored challenge');
    }
  }

  private normalizeOrigin(origin?: string): string | null {
    if (!origin) {
      return null;
    }

    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  private isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }
}

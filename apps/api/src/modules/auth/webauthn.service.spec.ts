import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { WebAuthnService } from './webauthn.service';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

describe('WebAuthnService', () => {
  const configService = {
    get: jest.fn((path: string) => {
      switch (path) {
        case 'app.data.redisKeyPrefix':
          return 'platform';
        case 'app.auth.webauthn.rpName':
          return 'banking-platform-api';
        case 'app.auth.webauthn.rpId':
          return 'localhost';
        case 'app.auth.webauthn.origins':
          return ['http://localhost:3000'];
        case 'app.auth.webauthn.timeoutMs':
          return 60000;
        default:
          return undefined;
      }
    }),
  };

  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };

  const redisService = {
    ensureAvailable: jest.fn(async () => undefined),
    client: redisClient,
  };

  let service: WebAuthnService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebAuthnService(configService as never, redisService as never);
  });

  it('creates registration options and stores the registration challenge', async () => {
    (generateRegistrationOptions as jest.Mock).mockResolvedValue({
      challenge: 'challenge-1',
    });

    const result = await service.beginRegistration(
      'sess_1',
      {
        id: 'usr_1',
        email: 'admin@example.com',
        displayName: 'Admin',
      },
      [],
    );

    expect(generateRegistrationOptions).toHaveBeenCalled();
    expect(redisClient.set).toHaveBeenCalledWith(
      'platform:webauthn:registration:sess_1',
      JSON.stringify({ challenge: 'challenge-1' }),
      'EX',
      120,
    );
    expect(result.challenge).toBe('challenge-1');
  });

  it('rejects authentication options when no active credentials exist', async () => {
    await expect(service.beginAuthentication('sess_1', 'login', [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('verifies authentication using the stored challenge and consumes it', async () => {
    redisClient.eval.mockResolvedValue(JSON.stringify({ challenge: 'challenge-1', purpose: 'login' }));
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'webauthn_1',
        newCounter: 2,
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    });

    const result = await service.finishAuthentication(
      'sess_1',
      'login',
      {
        id: 'webauthn_1',
        rawId: 'webauthn_1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      },
      {
        id: 'webauthn_1',
        credentialId: 'webauthn_1',
        publicKey: Buffer.from('public-key'),
        counter: 1,
        transports: ['internal'],
      },
    );

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1])"),
      1,
      'platform:webauthn:authentication:sess_1',
    );
    expect(verifyAuthenticationResponse).toHaveBeenCalled();
    expect(result.verified).toBe(true);
  });

  it('fails registration verification when the challenge is missing', async () => {
    redisClient.eval.mockResolvedValue(null);

    await expect(
      service.finishRegistration('sess_1', {
        id: 'webauthn_1',
        rawId: 'webauthn_1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });
});

import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

export interface PacStampRequest {
  invoiceId: string;
  folio: string;
  customerTaxId: string;
  currency: string;
  subtotal: string;
  total: string;
  paymentId?: string | null;
  requestId?: string;
}

export interface PacCancelRequest {
  invoiceId: string;
  folio: string;
  pacReference: string;
  reason: string;
  requestId?: string;
}

export interface PacStampResult {
  pacReference: string;
  provider: string;
  stampedAt: Date;
}

export interface PacCancelResult {
  cancellationRef: string;
  provider: string;
  cancelledAt: Date;
}

@Injectable()
export class PacService {
  private readonly logger = new Logger(PacService.name);

  constructor(private readonly configService: ConfigService) {}

  async stampInvoice(payload: PacStampRequest): Promise<PacStampResult> {
    const provider = this.getProvider();

    if (provider === 'mock') {
      this.assertMockAllowed();
      return {
        pacReference: `PAC-${randomUUID()}`,
        provider,
        stampedAt: new Date(),
      };
    }

    const response = await this.callProvider('/stamp', payload);
    const pacReference = this.asNonEmptyString(response.pacReference, 'PAC stamp response');

    return {
      pacReference,
      provider,
      stampedAt: this.asOptionalDate(response.stampedAt) ?? new Date(),
    };
  }

  async cancelInvoice(payload: PacCancelRequest): Promise<PacCancelResult> {
    const provider = this.getProvider();

    if (provider === 'mock') {
      this.assertMockAllowed();
      return {
        cancellationRef: `PAC-CANCEL-${randomUUID()}`,
        provider,
        cancelledAt: new Date(),
      };
    }

    const response = await this.callProvider('/cancel', payload);
    const cancellationRef = this.asNonEmptyString(
      response.cancellationRef,
      'PAC cancel response',
    );

    return {
      cancellationRef,
      provider,
      cancelledAt: this.asOptionalDate(response.cancelledAt) ?? new Date(),
    };
  }

  private async callProvider(
    path: '/stamp' | '/cancel',
    payload: PacStampRequest | PacCancelRequest,
  ): Promise<Record<string, unknown>> {
    const baseUrl =
      this.configService.get<string>('app.integrations.pac.baseUrl', { infer: true }) ?? '';
    const apiKey =
      this.configService.get<string>('app.integrations.pac.apiKey', { infer: true }) ?? '';
    const timeoutMs =
      this.configService.get<number>('app.integrations.pac.timeoutMs', { infer: true }) ?? 10_000;

    if (!baseUrl) {
      throw new ServiceUnavailableException('PAC provider is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadGatewayException(`PAC provider responded with status ${response.status}`);
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('PAC provider timed out');
      }

      this.logger.error(
        `PAC request failed on ${path}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException('PAC provider request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private getProvider(): string {
    return (
      this.configService.get<string>('app.integrations.pac.provider', { infer: true }) ?? 'mock'
    ).trim();
  }

  private assertMockAllowed(): void {
    const env = this.configService.get<string>('app.env', { infer: true }) ?? 'development';
    const allowMockInProduction =
      this.configService.get<boolean>('app.integrations.pac.allowMockInProduction', {
        infer: true,
      }) ?? false;

    if (env === 'production' && !allowMockInProduction) {
      throw new ServiceUnavailableException(
        'Mock PAC provider is not allowed in production. Configure a real PAC provider.',
      );
    }
  }

  private asNonEmptyString(value: unknown, source: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    throw new BadGatewayException(`${source} did not include a valid reference`);
  }

  private asOptionalDate(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

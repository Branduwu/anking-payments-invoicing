import { ServiceUnavailableException } from '@nestjs/common';
import { PacConfirmationRequiredException, PacService } from './pac.service';

describe('PacService', () => {
  it('returns mock stamping data in non-production environments', async () => {
    const configService = {
      get: jest.fn((path: string) => {
        switch (path) {
          case 'app.integrations.pac.provider':
            return 'mock';
          case 'app.env':
            return 'development';
          case 'app.integrations.pac.allowMockInProduction':
            return false;
          default:
            return undefined;
        }
      }),
    };

    const service = new PacService(configService as never);
    const result = await service.stampInvoice({
      invoiceId: 'inv_1',
      operationId: 'stamp_001',
      folio: 'INV-001',
      customerTaxId: 'XAXX010101000',
      currency: 'MXN',
      subtotal: '100.00',
      total: '116.00',
    });

    expect(result.provider).toBe('mock');
    expect(result.pacReference).toContain('PAC-');
  });

  it('rejects the mock provider in production by default', async () => {
    const configService = {
      get: jest.fn((path: string) => {
        switch (path) {
          case 'app.integrations.pac.provider':
            return 'mock';
          case 'app.env':
            return 'production';
          case 'app.integrations.pac.allowMockInProduction':
            return false;
          default:
            return undefined;
        }
      }),
    };

    const service = new PacService(configService as never);

    await expect(
      service.stampInvoice({
        invoiceId: 'inv_1',
        operationId: 'stamp_001',
        folio: 'INV-001',
        customerTaxId: 'XAXX010101000',
        currency: 'MXN',
        subtotal: '100.00',
        total: '116.00',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('marks custom PAC transport failures as confirmation-required outcomes', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('socket hang up'));
    const configService = {
      get: jest.fn((path: string) => {
        switch (path) {
          case 'app.integrations.pac.provider':
            return 'custom-http';
          case 'app.integrations.pac.baseUrl':
            return 'https://pac.example.test';
          case 'app.integrations.pac.apiKey':
            return 'secret';
          case 'app.integrations.pac.timeoutMs':
            return 1000;
          default:
            return undefined;
        }
      }),
    };

    const service = new PacService(configService as never);

    await expect(
      service.stampInvoice({
        invoiceId: 'inv_1',
        operationId: 'stamp_001',
        folio: 'INV-001',
        customerTaxId: 'XAXX010101000',
        currency: 'MXN',
        subtotal: '100.00',
        total: '116.00',
      }),
    ).rejects.toBeInstanceOf(PacConfirmationRequiredException);

    fetchSpy.mockRestore();
  });
});

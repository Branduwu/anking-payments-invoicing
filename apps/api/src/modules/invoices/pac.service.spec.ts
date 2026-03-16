import { ServiceUnavailableException } from '@nestjs/common';
import { PacService } from './pac.service';

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
        folio: 'INV-001',
        customerTaxId: 'XAXX010101000',
        currency: 'MXN',
        subtotal: '100.00',
        total: '116.00',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

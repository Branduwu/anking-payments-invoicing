import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthPayload, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live(): HealthPayload {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  async ready(): Promise<HealthPayload> {
    const readiness = await this.healthService.getReadiness();

    if (readiness.status !== 'ready') {
      throw new ServiceUnavailableException({
        message: 'Dependencies are not ready',
        ...readiness,
      });
    }

    return readiness;
  }
}

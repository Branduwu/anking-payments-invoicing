import {
  Controller,
  Get,
  Headers,
  Header,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from './observability.service';

@Controller('metrics')
export class ObservabilityController {
  constructor(
    private readonly observabilityService: ObservabilityService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(@Headers('authorization') authorization?: string): string {
    const metricsBearerToken =
      this.configService.get<string>('app.observability.metricsBearerToken', {
        infer: true,
      }) ?? '';

    if (metricsBearerToken && authorization !== `Bearer ${metricsBearerToken}`) {
      throw new UnauthorizedException('Metrics token is required');
    }

    return this.observabilityService.renderMetrics();
  }
}

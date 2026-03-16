import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Get('live')
  live(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      await this.redisService.ping();
    } catch {
      throw new ServiceUnavailableException('Dependencies are not ready');
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }
}

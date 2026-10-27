import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { getRedisConfig } from '@mybusiness/common';
import Redis from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private redisClient?: Redis;

  constructor(private readonly config: ConfigService) {}

  private getRedis(): Redis {
    if (!this.redisClient) {
      const redisOptions = getRedisConfig(this.config);
      this.redisClient = new Redis({
        host: redisOptions.host,
        port: redisOptions.port,
        password: redisOptions.password,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
      });
    }
    return this.redisClient;
  }

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    try {
      const redis = this.getRedis();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Respuesta inesperada de Redis: ${pong}`);
      }
      return {
        status: 'ready',
        uptime: process.uptime(),
        redis: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      throw new HttpException(
        {
          status: 'not_ready',
          uptime: process.uptime(),
          redis: 'disconnected',
          error: err?.message || 'Redis no disponible',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

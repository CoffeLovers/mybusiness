import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { getRedisConfig, Public } from '@mybusiness/common';
import Redis from 'ioredis';

@ApiTags('Health')
@Public()
@SkipThrottle({ default: true, auth: true, api: true, heavy: true })
@Controller(['health', 'healthz'])
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
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('liveness')
  liveness() {
    return {
      status: 'ok',
      service: 'api-gateway',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get(['ready', 'readiness'])
  async readiness() {
    try {
      const redis = this.getRedis();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Respuesta inesperada de Redis: ${pong}`);
      }
      return {
        status: 'ready',
        service: 'api-gateway',
        uptime: Math.floor(process.uptime()),
        checks: {
          redis: 'connected',
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      throw new HttpException(
        {
          status: 'not_ready',
          service: 'api-gateway',
          uptime: Math.floor(process.uptime()),
          checks: {
            redis: 'disconnected',
          },
          error: err?.message || 'Redis no disponible',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

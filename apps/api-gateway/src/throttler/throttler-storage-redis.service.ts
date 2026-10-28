import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis, { RedisOptions } from 'ioredis';
import { RedisConnectionConfig } from '@mybusiness/common';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(ThrottlerStorageRedisService.name);
  private readonly redis: Redis;
  private readonly isCustomClient: boolean;

  /**
   * Script Lua atómico para rate-limiting distribuido:
   * 1. Verifica si la clave se encuentra en período de bloqueo (blockDuration).
   * 2. Incrementa atómicamente el contador de peticiones.
   * 3. Establece la ventana de expiración en milisegundos (PEXPIRE) en el primer golpe.
   * 4. Si supera el límite permitido, activa el bloqueo y retorna el tiempo restante.
   */
  private readonly luaScript = `
    local key = KEYS[1]
    local blockKey = KEYS[2]
    local ttl = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local blockDuration = tonumber(ARGV[3])

    -- 1. Verificar si ya está bloqueado
    local isBlocked = redis.call('EXISTS', blockKey)
    if isBlocked == 1 then
      local timeToBlockExpire = redis.call('PTTL', blockKey)
      return { 0, 0, 1, math.max(0, timeToBlockExpire) }
    end

    -- 2. Incrementar contador
    local totalHits = redis.call('INCR', key)
    if totalHits == 1 then
      redis.call('PEXPIRE', key, ttl)
    end

    local timeToExpire = redis.call('PTTL', key)

    -- 3. Comprobar si sobrepasa el límite
    if totalHits > limit then
      if blockDuration > 0 then
        redis.call('PSETEX', blockKey, blockDuration, '1')
        return { totalHits, timeToExpire, 1, blockDuration }
      end
      return { totalHits, timeToExpire, 1, math.max(0, timeToExpire) }
    end

    return { totalHits, math.max(0, timeToExpire), 0, 0 }
  `;

  constructor(redisOrConfig: Redis | RedisConnectionConfig) {
    if (redisOrConfig instanceof Redis) {
      this.redis = redisOrConfig;
      this.isCustomClient = true;
    } else {
      this.redis = new Redis({
        host: redisOrConfig.host,
        port: redisOrConfig.port,
        password: redisOrConfig.password,
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
      } as RedisOptions);
      this.isCustomClient = false;
    }

    this.redis.on('error', (err) => {
      this.logger.error(`Error en cliente Redis de Throttler: ${err.message}`);
    });
  }

  getRedisClient(): Redis {
    return this.redis;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    try {
      const result = (await this.redis.eval(
        this.luaScript,
        2,
        redisKey,
        blockKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

      const totalHits = Number(result[0]);
      const timeToExpire = Math.max(0, Number(result[1]));
      const isBlocked = Number(result[2]) === 1;
      const timeToBlockExpire = Math.max(0, Number(result[3]));

      return {
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire,
      };
    } catch (error) {
      this.logger.warn(
        `Fallo al ejecutar evaluación en Redis para rate-limit (${(error as Error).message}). Fail-open activado.`,
      );
      // Fail-open: no detener tráfico legítimo si Redis presenta intermitencia transitoria
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.isCustomClient && this.redis.status !== 'end') {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}

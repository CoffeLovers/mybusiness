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

interface MemoryFallbackRecord {
  totalHits: number;
  expiresAt: number;
  blockExpiresAt?: number;
}

@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(ThrottlerStorageRedisService.name);
  private readonly redis: Redis;
  private readonly isCustomClient: boolean;

  /**
   * Fallback resiliente en memoria local por instancia:
   * Si Redis experimenta una caída o degradación temporal, el servicio no realiza un
   * fail-open ciego, sino que mantiene el control de cuotas y fuerza bruta localmente.
   */
  private readonly memoryFallback = new Map<string, MemoryFallbackRecord>();

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
    if (
      redisOrConfig instanceof Redis ||
      (redisOrConfig && typeof (redisOrConfig as any).eval === 'function')
    ) {
      this.redis = redisOrConfig as Redis;
      this.isCustomClient = true;
    } else {
      const config = redisOrConfig as RedisConnectionConfig;
      this.redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
      } as RedisOptions);
      this.isCustomClient = false;
    }

    if (typeof this.redis.on === 'function') {
      this.redis.on('error', (err) => {
        this.logger.error(`Error en cliente Redis de Throttler: ${err.message}`);
      });
    }
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
        `Fallo al evaluar rate-limit en Redis (${(error as Error).message}). Activando fallback local en memoria para clave '${redisKey}'.`,
      );
      // Fallback local en memoria: protege contra fuerza bruta aun con Redis caído
      return this.handleMemoryFallback(redisKey, ttl, limit, blockDuration);
    }
  }

  private handleMemoryFallback(
    redisKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    let record = this.memoryFallback.get(redisKey);

    // Limpieza preventiva si el registro ya expiró
    if (
      record &&
      record.expiresAt <= now &&
      (!record.blockExpiresAt || record.blockExpiresAt <= now)
    ) {
      this.memoryFallback.delete(redisKey);
      record = undefined;
    }

    if (!record) {
      record = {
        totalHits: 1,
        expiresAt: now + ttl,
      };
      this.memoryFallback.set(redisKey, record);
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    // Verificar si se encuentra bloqueado
    if (record.blockExpiresAt && record.blockExpiresAt > now) {
      return {
        totalHits: record.totalHits,
        timeToExpire: Math.max(0, record.expiresAt - now),
        isBlocked: true,
        timeToBlockExpire: Math.max(0, record.blockExpiresAt - now),
      };
    }

    record.totalHits += 1;
    const timeToExpire = Math.max(0, record.expiresAt - now);

    if (record.totalHits > limit) {
      const blockTime = blockDuration > 0 ? blockDuration : timeToExpire;
      record.blockExpiresAt = now + blockTime;
      return {
        totalHits: record.totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: blockTime,
      };
    }

    return {
      totalHits: record.totalHits,
      timeToExpire,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.memoryFallback.clear();
    if (!this.isCustomClient && this.redis.status !== 'end') {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}

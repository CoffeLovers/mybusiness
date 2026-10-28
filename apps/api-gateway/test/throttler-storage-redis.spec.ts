import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { ThrottlerStorageRedisService } from '../src/throttler/throttler-storage-redis.service';

describe('ThrottlerStorageRedisService', () => {
  let redisClient: Redis;
  let service: ThrottlerStorageRedisService;
  const testKey = `test-client-${Date.now()}`;

  beforeAll(async () => {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6380),
      password: process.env.REDIS_PASSWORD || 'change_in_production_redis_secret',
      lazyConnect: false,
    });
    service = new ThrottlerStorageRedisService(redisClient);
  });

  afterAll(async () => {
    // Limpiar claves de test
    const keys = await redisClient.keys(`throttle:*:${testKey}*`);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
    await redisClient.quit();
  });

  it('debe incrementar hits y retornar expiración correcta en la primera petición', async () => {
    const record = await service.increment(testKey, 10000, 5, 0, 'auth');
    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
    expect(record.timeToExpire).toBeGreaterThan(0);
    expect(record.timeToExpire).toBeLessThanOrEqual(10000);
  });

  it('debe acumular hits secuenciales correctamente', async () => {
    const record2 = await service.increment(testKey, 10000, 5, 0, 'auth');
    expect(record2.totalHits).toBe(2);
    expect(record2.isBlocked).toBe(false);
  });

  it('debe bloquear la petición cuando los hits superan el límite establecido', async () => {
    await service.increment(testKey, 10000, 5, 0, 'auth'); // hit 3
    await service.increment(testKey, 10000, 5, 0, 'auth'); // hit 4
    const record5 = await service.increment(testKey, 10000, 5, 0, 'auth'); // hit 5
    expect(record5.totalHits).toBe(5);
    expect(record5.isBlocked).toBe(false);

    // Hit 6: debe superar el límite de 5
    const blockedRecord = await service.increment(testKey, 10000, 5, 0, 'auth');
    expect(blockedRecord.totalHits).toBe(6);
    expect(blockedRecord.isBlocked).toBe(true);
    expect(blockedRecord.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('debe soportar blockDuration explícito y mantener el bloqueo', async () => {
    const blockedKey = `test-blocked-${Date.now()}`;
    // Límite de 2 con blockDuration de 5000 ms
    await service.increment(blockedKey, 10000, 2, 5000, 'heavy');
    await service.increment(blockedKey, 10000, 2, 5000, 'heavy');
    const blockedRecord = await service.increment(blockedKey, 10000, 2, 5000, 'heavy');

    expect(blockedRecord.isBlocked).toBe(true);
    expect(blockedRecord.timeToBlockExpire).toBeGreaterThan(0);
    expect(blockedRecord.timeToBlockExpire).toBeLessThanOrEqual(5000);

    // Siguiente intento inmediato debe reportar bloqueo
    const stillBlocked = await service.increment(blockedKey, 10000, 2, 5000, 'heavy');
    expect(stillBlocked.isBlocked).toBe(true);
    expect(stillBlocked.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('debe activar fail-open y no tirar excepciones si Redis falla', async () => {
    // Cliente desconectado deliberadamente
    const brokenRedis = new Redis({
      host: 'invalid-host-unreachable',
      port: 9999,
      connectTimeout: 200,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    const brokenService = new ThrottlerStorageRedisService(brokenRedis);

    const fallbackRecord = await brokenService.increment('any-key', 60000, 5, 0, 'auth');
    expect(fallbackRecord.totalHits).toBe(1);
    expect(fallbackRecord.isBlocked).toBe(false);

    brokenRedis.disconnect();
  });
});

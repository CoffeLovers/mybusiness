import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Redis from 'ioredis';
import { loadRootEnv } from '@mybusiness/common';
import { ThrottlerStorageRedisService } from '../src/throttler/throttler-storage-redis.service';

loadRootEnv();

describe('ThrottlerStorageRedisService (Unit & Multi-Instance)', () => {
  describe('Pruebas Unitarias Herméticas (Mock Redis)', () => {
    it('debe invocar el script Lua con los parámetros correctos y mapear la respuesta atómica', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([1, 60000, 0, 0]),
      } as unknown as Redis;

      const service = new ThrottlerStorageRedisService(mockRedis);
      const result = await service.increment('test-client-1', 60000, 5, 0, 'auth');

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      const evalArgs = (mockRedis.eval as any).mock.calls[0];
      expect(evalArgs[1]).toBe(2); // 2 KEYS
      expect(evalArgs[2]).toBe('throttle:auth:test-client-1'); // KEY 1
      expect(evalArgs[3]).toBe('throttle:block:auth:test-client-1'); // KEY 2
      expect(evalArgs[4]).toBe(60000); // ARGV 1 (ttl)
      expect(evalArgs[5]).toBe(5); // ARGV 2 (limit)
      expect(evalArgs[6]).toBe(0); // ARGV 3 (blockDuration)

      expect(result.totalHits).toBe(1);
      expect(result.timeToExpire).toBe(60000);
      expect(result.isBlocked).toBe(false);
      expect(result.timeToBlockExpire).toBe(0);
    });

    it('debe mapear correctamente un estado bloqueado retornado por Lua', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([6, 45000, 1, 30000]),
      } as unknown as Redis;

      const service = new ThrottlerStorageRedisService(mockRedis);
      const result = await service.increment('test-client-blocked', 60000, 5, 30000, 'auth');

      expect(result.totalHits).toBe(6);
      expect(result.timeToExpire).toBe(45000);
      expect(result.isBlocked).toBe(true);
      expect(result.timeToBlockExpire).toBe(30000);
    });

    it('debe activar fallback local en memoria ante caída de Redis y bloquear al alcanzar el límite', async () => {
      const brokenRedis = {
        eval: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as Redis;

      const service = new ThrottlerStorageRedisService(brokenRedis);
      const key = 'fallback-client';

      // 5 peticiones permitidas en fallback local
      for (let i = 1; i <= 5; i++) {
        const record = await service.increment(key, 10000, 5, 0, 'auth');
        expect(record.totalHits).toBe(i);
        expect(record.isBlocked).toBe(false);
      }

      // La 6ta petición debe quedar bloqueada en la memoria local
      const blockedRecord = await service.increment(key, 10000, 5, 0, 'auth');
      expect(blockedRecord.totalHits).toBe(6);
      expect(blockedRecord.isBlocked).toBe(true);
    });
  });

  describe('Pruebas de Coordinación entre Múltiples Instancias (Redis Real)', () => {
    let clientA: Redis;
    let clientB: Redis;
    let serviceA: ThrottlerStorageRedisService;
    let serviceB: ThrottlerStorageRedisService;
    let isRedisAvailable = false;
    const testPrefix = `multi-instance-${Date.now()}`;

    beforeAll(async () => {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = Number(process.env.REDIS_PORT || 6380);
      const password = process.env.REDIS_PASSWORD;

      clientA = new Redis({
        host,
        port,
        password,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });

      clientB = new Redis({
        host,
        port,
        password,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });

      try {
        await Promise.all([clientA.connect(), clientB.connect()]);
        await clientA.ping();
        isRedisAvailable = true;
        serviceA = new ThrottlerStorageRedisService(clientA);
        serviceB = new ThrottlerStorageRedisService(clientB);
      } catch {
        isRedisAvailable = false;
      }
    });

    afterAll(async () => {
      if (isRedisAvailable) {
        const keys = await clientA.keys(`throttle:*:${testPrefix}*`);
        if (keys.length > 0) {
          await clientA.del(...keys);
        }
        await Promise.all([clientA.quit(), clientB.quit()]);
      }
    });

    it('debe sincronizar atómicamente el contador entre réplicas independientes A y B', async () => {
      if (!isRedisAvailable) {
        return; // Salta si el contenedor Redis no está disponible en este entorno
      }

      const sharedKey = `${testPrefix}-sync`;
      const limit = 4;
      const ttl = 30000;

      // Réplica A realiza hit 1
      const hit1 = await serviceA.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit1.totalHits).toBe(1);
      expect(hit1.isBlocked).toBe(false);

      // Réplica B realiza hit 2: ve el incremento de la réplica A
      const hit2 = await serviceB.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit2.totalHits).toBe(2);
      expect(hit2.isBlocked).toBe(false);

      // Réplica A realiza hit 3
      const hit3 = await serviceA.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit3.totalHits).toBe(3);

      // Réplica B realiza hit 4 (alcanza el límite)
      const hit4 = await serviceB.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit4.totalHits).toBe(4);
      expect(hit4.isBlocked).toBe(false);

      // Réplica A realiza hit 5: debe ser bloqueada inmediatamente por estado distribuido
      const hit5 = await serviceA.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit5.totalHits).toBe(5);
      expect(hit5.isBlocked).toBe(true);

      // Réplica B realiza hit 6: también está bloqueada en su propia réplica
      const hit6 = await serviceB.increment(sharedKey, ttl, limit, 0, 'api');
      expect(hit6.totalHits).toBe(6);
      expect(hit6.isBlocked).toBe(true);
    });
  });
});

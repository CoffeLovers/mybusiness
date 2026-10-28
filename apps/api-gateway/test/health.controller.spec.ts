import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HealthController } from '../src/health/health.controller';

describe('HealthController (Unit)', () => {
  let controller: HealthController;
  let config: ConfigService;

  beforeEach(() => {
    config = { get: vi.fn() } as unknown as ConfigService;
    controller = new HealthController(config);
  });

  it('check() devuelve status ok, service api-gateway y timestamp', () => {
    const res = controller.check();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('api-gateway');
    expect(typeof res.timestamp).toBe('string');
  });

  it('ready() lanza 503 cuando Redis no responde', async () => {
    // Forzar cliente Redis que falla
    const redisMock = { ping: vi.fn().mockRejectedValue(new Error('Redis down')) };
    (controller as any).redisClient = redisMock;

    await expect(controller.ready()).rejects.toThrow();
    try {
      await controller.ready();
    } catch (e: any) {
      expect(e.status).toBe(503);
      expect(e.response.redis).toBe('disconnected');
    }
  });

  it('ready() devuelve ready cuando Redis responde PONG', async () => {
    const redisMock = { ping: vi.fn().mockResolvedValue('PONG') };
    (controller as any).redisClient = redisMock;

    const res = await controller.ready();
    expect(res.status).toBe('ready');
    expect(res.redis).toBe('connected');
  });
});

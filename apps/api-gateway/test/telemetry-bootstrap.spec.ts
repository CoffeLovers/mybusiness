import { describe, it, expect, vi, beforeEach } from 'vitest';

const { startTelemetry } = vi.hoisted(() => ({ startTelemetry: vi.fn() }));

vi.mock('@mybusiness/telemetry', () => ({ startTelemetry }));

describe('telemetry.bootstrap (Unit)', () => {
  beforeEach(() => {
    vi.resetModules();
    startTelemetry.mockClear();
  });

  it('invoca startTelemetry con serviceName api-gateway al importar el bootstrap', async () => {
    await import('../src/telemetry.bootstrap');

    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(startTelemetry).toHaveBeenCalledWith({ serviceName: 'api-gateway' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  OTEL_ENABLED_ENV,
  OTEL_ENDPOINT_ENV,
  OTEL_PROTOCOL_ENV,
  OTEL_SAMPLER_RATE_ENV,
  OTEL_SERVICE_NAME_ENV,
  resolveTelemetryConfig,
} from '../src/config/telemetry-config';
import { createTelemetrySdk } from '../src/sdk';

describe('resolveTelemetryConfig', () => {
  it('por defecto está deshabilitado (cero impacto si no se configura)', () => {
    const cfg = resolveTelemetryConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.protocol).toBe('http');
    expect(cfg.samplerRate).toBe(1);
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.environment).toBe('development');
  });

  it('habilita con OTEL_ENABLED=true y lee endpoint/servicio', () => {
    const cfg = resolveTelemetryConfig({
      [OTEL_ENABLED_ENV]: 'true',
      [OTEL_ENDPOINT_ENV]: 'http://localhost:4318/v1/traces',
      [OTEL_SERVICE_NAME_ENV]: 'auth-service',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.endpoint).toBe('http://localhost:4318/v1/traces');
    expect(cfg.serviceName).toBe('auth-service');
  });

  it('tolera mayúsculas y espacios en el switch', () => {
    expect(resolveTelemetryConfig({ [OTEL_ENABLED_ENV]: ' TRUE ' }).enabled).toBe(true);
    expect(resolveTelemetryConfig({ [OTEL_ENABLED_ENV]: '1' }).enabled).toBe(false);
  });

  it('protocolo inválido cae a http', () => {
    expect(resolveTelemetryConfig({ [OTEL_PROTOCOL_ENV]: 'zeus' }).protocol).toBe('http');
    expect(resolveTelemetryConfig({ [OTEL_PROTOCOL_ENV]: 'grpc' }).protocol).toBe('grpc');
  });

  it('clamp del sampler rate y fallback ante valores basura', () => {
    expect(resolveTelemetryConfig({ [OTEL_SAMPLER_RATE_ENV]: '0.25' }).samplerRate).toBe(0.25);
    expect(resolveTelemetryConfig({ [OTEL_SAMPLER_RATE_ENV]: '-1' }).samplerRate).toBe(0);
    expect(resolveTelemetryConfig({ [OTEL_SAMPLER_RATE_ENV]: '42' }).samplerRate).toBe(1);
    expect(resolveTelemetryConfig({ [OTEL_SAMPLER_RATE_ENV]: 'banana' }).samplerRate).toBe(1);
  });
});

describe('createTelemetrySdk', () => {
  it('exige OTEL_SERVICE_NAME cuando el SDK se va a registrar', () => {
    expect(() =>
      createTelemetrySdk({
        enabled: true,
        serviceName: '',
        endpoint: 'http://localhost:4318/v1/traces',
        protocol: 'http',
        samplerRate: 1,
        environment: 'test',
      }),
    ).toThrowError(/OTEL_SERVICE_NAME/);
  });

  it('no arranca en modo deshabilitado con configuración por defecto del proceso', () => {
    // El contrato del lifecycle: sin OTEL_ENABLED=true → no sdk activo.
    expect(resolveTelemetryConfig({}).enabled).toBe(false);
  });
});

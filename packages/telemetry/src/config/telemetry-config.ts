/**
 * Resolución de la configuración de OpenTelemetry a partir de variables de entorno.
 *
 * 100 % configurable por entorno, sin credenciales ni endpoints hardcodeados:
 * si `OTEL_ENABLED` no es `true`, la instrumentación queda desactivada
 * (default off → cero impacto si no se configura).
 */
export interface TelemetryConfig {
  /** Master switch: solo se instrumenta con `OTEL_ENABLED=true`. */
  enabled: boolean;
  /** Nombre del servicio tal como se ve en el backend de trazas (`service.name`). */
  serviceName: string;
  /** Endpoint OTLP del collector (URL completa por señal). Indefinido si no se configura. */
  endpoint: string | undefined;
  /** Protocolo del exportador OTLP: `http` (default) o `grpc`. */
  protocol: 'http' | 'grpc';
  /** Ratio de muestreo de trazas raíz (0..1). Default `1`. */
  samplerRate: number;
  /** `deployment.environment.name` derivado de `NODE_ENV`. */
  environment: string;
}

/** Header opcional que marca el canal de entrada (`web`, `api`, `cron`, ...). */
export const CHANNEL_HEADER = 'x-mybusiness-channel';

/** Canal por defecto cuando no hay header explícito. */
export const DEFAULT_CHANNEL = 'web';

/** Límite inferior y superior del ratio de muestreo. */
export const SAMPLER_RATE_MIN = 0;
export const SAMPLER_RATE_MAX = 1;

/** Ratio de muestreo por defecto (muestra todas las trazas raíz). */
export const SAMPLER_RATE_DEFAULT = 1;

export const OTEL_ENABLED_ENV = 'OTEL_ENABLED';
export const OTEL_ENDPOINT_ENV = 'OTEL_EXPORTER_OTLP_ENDPOINT';
export const OTEL_PROTOCOL_ENV = 'OTEL_EXPORTER_OTLP_PROTOCOL';
export const OTEL_SAMPLER_RATE_ENV = 'OTEL_TRACES_SAMPLER_RATE';
export const OTEL_SERVICE_NAME_ENV = 'OTEL_SERVICE_NAME';

type EnvLike = Record<string, string | undefined>;

function isOtelProtocol(value: string): value is 'http' | 'grpc' {
  return value === 'http' || value === 'grpc';
}

function parseSamplerRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return SAMPLER_RATE_DEFAULT;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return SAMPLER_RATE_DEFAULT;
  }
  if (parsed < SAMPLER_RATE_MIN) {
    return SAMPLER_RATE_MIN;
  }
  if (parsed > SAMPLER_RATE_MAX) {
    return SAMPLER_RATE_MAX;
  }
  return parsed;
}

export function resolveTelemetryConfig(env: EnvLike): TelemetryConfig {
  const protocolRaw = (env[OTEL_PROTOCOL_ENV] ?? 'http').trim().toLowerCase();
  const protocol = isOtelProtocol(protocolRaw) ? protocolRaw : 'http';

  return {
    enabled: (env[OTEL_ENABLED_ENV] ?? '').trim().toLowerCase() === 'true',
    serviceName: (env[OTEL_SERVICE_NAME_ENV] ?? '').trim(),
    endpoint: env[OTEL_ENDPOINT_ENV]?.trim() || undefined,
    protocol,
    samplerRate: parseSamplerRate(env[OTEL_SAMPLER_RATE_ENV]),
    environment: (env['NODE_ENV'] ?? 'development').trim(),
  };
}

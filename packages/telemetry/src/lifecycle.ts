/**
 * Ciclo de vida del SDK de OpenTelemetry.
 *
 * `startTelemetry()` debe llamarse lo antes posible en cada proceso
 * (en `main.ts` antes del bootstrap Nest; en apps/web dentro de `instrumentation.ts`).
 * Cuando OTEL_ENABLED no es true (o futura configuración sin endpoint) NO se
 * registra nada: cero impacto por defecto.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resolveTelemetryConfig } from './config/telemetry-config';
import { createTelemetrySdk } from './sdk';

type EnvLike = Record<string, string | undefined>;

export type TelemetryStartStatus = 'disabled' | 'started' | 'already-active';

let activeSdk: NodeSDK | undefined;

export function isTelemetryActive(): boolean {
  return activeSdk !== undefined;
}

export interface TelemetryStartOptions {
  /** Nombre del servicio (`service.name`). Si no llega, se usa OTEL_SERVICE_NAME. */
  serviceName?: string;
}

/**
 * Arranca el SDK si y solo si el entorno lo solicita (OTEL_ENABLED=true y endpoint).
 * Idempotente: si ya está activo no registra dos veces.
 */
export function startTelemetry(
  options: TelemetryStartOptions,
  env: EnvLike = process.env,
): TelemetryStartStatus {
  if (activeSdk !== undefined) {
    return 'already-active';
  }
  const cfg = resolveTelemetryConfig(env);
  if (!cfg.enabled) {
    return 'disabled';
  }
  if (cfg.endpoint === undefined) {
    // Sin collector configurado no hay instrumentación: evita spans a canto.
    return 'disabled';
  }
  const serviceName = options.serviceName ?? cfg.serviceName;
  activeSdk = createTelemetrySdk({ ...cfg, serviceName });
  activeSdk.start();
  return 'started';
}

/** Shutdown ordenado al apagar el proceso (app.enableShutdownHooks()). */
export async function shutdownTelemetry(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = undefined;
  if (sdk) {
    await sdk.shutdown();
  }
}

/** Acceso tipado a la API de tracing global de OpenTelemetry. */
import { trace } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

const TRACER_SCOPE = '@mybusiness/telemetry';

/** Tracer global del SDK (no-op si el SDK no está activo en el proceso). */
export function getTracer(scope: string = TRACER_SCOPE): Tracer {
  return trace.getTracer(scope);
}

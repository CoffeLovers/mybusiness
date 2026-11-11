/**
 * Hook de instrumentación de Next.js 15 (SF3-07).
 *
 * Next lo ejecuta una vez al arrancar el server (node runtime). Delegamos al
 * módulo server de OpenTelemetry para que el BFF genere spans y propague
 * `traceparent` en cada fetch hacia el API Gateway (instrumentación undici).
 */
export async function register(): Promise<void> {
  // En desarrollo local Next.js no carga el SDK de OpenTelemetry grpc
  if (process.env.NODE_ENV === 'production' && process.env.OTEL_ENABLED === 'true') {
    await import('./otel.server');
  }
}

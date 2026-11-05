/**
 * Hook de instrumentación de Next.js 15 (SF3-07).
 *
 * Next lo ejecuta una vez al arrancar el server (node runtime). Delegamos al
 * módulo server de OpenTelemetry para que el BFF genere spans y propague
 * `traceparent` en cada fetch hacia el API Gateway (instrumentación undici).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  await import('./otel.server');
}

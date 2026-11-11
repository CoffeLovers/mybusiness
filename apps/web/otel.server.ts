/**
 * Bootstrap OpenTelemetry del BFF de apps/web (solo runtime nodejs).
 *
 * - `service.name` = web-bff; exportador/propagadores/anti-PII centralizados en
 *   `@mybusiness/telemetry` (config 100 % por variables de entorno).
 * - La instrumentación undici inyecta `traceparent`/`tracestate`/`baggage` en
 *   cada fetch server-side hacia el API Gateway (BFF → gateway → microservicios).
 * - `startTelemetry` es no-op si OTEL_ENABLED no es `true` (default off).
 */
import { startTelemetry } from '@mybusiness/telemetry/lifecycle';

startTelemetry({ serviceName: 'web-bff' });

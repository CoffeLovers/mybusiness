/**
 * @mybusiness/telemetry — Bootstrap OpenTelemetry compartido (SF3-07).
 *
 * Uso en un servicio NestJS (main.ts, primera línea lógica):
 *
 *   import { startTelemetry } from '@mybusiness/telemetry';
 *   startTelemetry({ serviceName: 'auth-service' });
 *
 * Configuración por variables de entorno (sin defaults de credenciales):
 *   OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL,
 *   OTEL_TRACES_SAMPLER_RATE, OTEL_SERVICE_NAME.
 */
export {
  OTEL_ENABLED_ENV,
  OTEL_ENDPOINT_ENV,
  OTEL_PROTOCOL_ENV,
  OTEL_SAMPLER_RATE_ENV,
  OTEL_SERVICE_NAME_ENV,
  resolveTelemetryConfig,
} from './config/telemetry-config';
export type { TelemetryConfig } from './config/telemetry-config';
export { createTelemetrySdk } from './sdk';
export { isTelemetryActive, shutdownTelemetry, startTelemetry } from './lifecycle';
export type { TelemetryStartStatus } from './lifecycle';
export {
  RPC_CARRIER_CONTEXT_SYMBOL,
  RPC_CARRIER_WIRE_KEY,
  injectRpcCarrier,
  peekRpcCarrierContext,
  takeAndAttachRpcCarrier,
} from './carrier';
export type { RpcCarrier } from './carrier';
export {
  TelemetryRpcDeserializer,
  TelemetryRpcSerializer,
  withTelemetryTransport,
} from './redis-transport';
export { HttpTelemetryAttributesInterceptor, RpcTelemetryInterceptor } from './interceptors';
export { getTracer } from './trace';
export {
  SPAN_ATTR_CHANNEL,
  SPAN_ATTR_MESSAGING_SYSTEM,
  SPAN_ATTR_RPC_PATTERN,
  SPAN_ATTR_TENANT_ID,
  SPAN_ATTR_USER_ROLE,
} from './interceptors';
export {
  AgentMetrics,
  agentMetrics,
  METRIC_AGENT_FIRST_TOKEN_MS,
  METRIC_AGENT_STREAM_DURATION_MS,
  METRIC_AGENT_REQUESTS_TOTAL,
  METRIC_AGENT_CANCELLATIONS_TOTAL,
  METRIC_AGENT_ERRORS_TOTAL,
  SLO_FIRST_TOKEN_P95_MS,
  SLO_ERROR_RATE_MAX,
} from './agent-metrics';
export type { AgentMetricAttributes, RecordedMetricEntry } from './agent-metrics';

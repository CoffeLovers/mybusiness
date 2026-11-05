/**
 * Bootstrap del SDK de OpenTelemetry compartido por todos los servicios MyBusiness.
 *
 * Configuración 100 % por variables de entorno:
 *  - OTEL_ENABLED: master switch (default off → cero impacto).
 *  - OTEL_EXPORTER_OTLP_ENDPOINT: URL completa del collector (p. ej. http://localhost:4318/v1/traces).
 *  - OTEL_EXPORTER_OTLP_PROTOCOL: `http` (default) | `grpc`.
 *  - OTEL_TRACES_SAMPLER_RATE: ratio de muestreo raíz 0..1 (default 1).
 *  - OTEL_SERVICE_NAME: nombre del servicio en el backend de trazas.
 *
 * Propagadores: W3C TraceContext + W3C Baggage (CompositePropagator).
 * Anti-PII: se reescriben `url.full`/`url.query` sin query strings; los bodies
 * nunca se capturan.
 */
import type { Span } from '@opentelemetry/api';
import type { ClientRequest, IncomingMessage } from 'node:http';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter as OtlpTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OtlpTraceExporterGrpc } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation, type UndiciRequest } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { resolveTelemetryConfig, type TelemetryConfig } from './config/telemetry-config';

const DEPLOYMENT_ENVIRONMENT_ATTRIBUTE = 'deployment.environment.name';

/** Elimina la query string de una URL (los params pueden contener PII o tokens). */
function stripQuery(rawUrl: string): string {
  const qIndex = rawUrl.indexOf('?');
  return qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
}

/** Sobrescribe url.full / url.query en spans HTTP para que no contengan query params. */
function sanitizeHttpSpan(span: Span, request: IncomingMessage | ClientRequest): void {
  const urlLike: string | undefined =
    typeof request === 'object' && request !== null && 'url' in request
      ? (request as { url?: string }).url
      : typeof request === 'object' && request !== null && 'path' in request
        ? (request as { path?: string }).path
        : undefined;
  if (typeof urlLike === 'string') {
    span.setAttribute('url.full', stripQuery(urlLike));
    span.setAttribute('url.query', '');
  }
}

/** Instrumentación fetch/undici (Next.js BFF): reescribe url.full sin query. */
function sanitizeUndiciSpanRequest(span: Span, request: UndiciRequest): void {
  span.setAttribute('url.full', stripQuery(request.origin + request.path));
  span.setAttribute('url.query', '');
}

export function createTelemetrySdk(cfg: TelemetryConfig): NodeSDK {
  if (cfg.serviceName === '') {
    throw new Error('OTEL_SERVICE_NAME es obligatorio cuando OTEL_ENABLED=true');
  }

  const exporter =
    cfg.protocol === 'grpc'
      ? new OtlpTraceExporterGrpc({ url: cfg.endpoint })
      : new OtlpTraceExporterHttp({ url: cfg.endpoint });

  return new NodeSDK({
    serviceName: cfg.serviceName,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(cfg.samplerRate) }),
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({ applyCustomAttributesOnSpan: sanitizeHttpSpan }),
      new UndiciInstrumentation({ requestHook: sanitizeUndiciSpanRequest }),
    ],
    resource: resourceFromAttributes({ [DEPLOYMENT_ENVIRONMENT_ATTRIBUTE]: cfg.environment }),
  });
}

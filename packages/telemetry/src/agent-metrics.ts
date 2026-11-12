/**
 * Métricas de observabilidad OpenTelemetry para el agente conversacional (SF4-12, #65).
 *
 * Expone histogramas y contadores tipados para medir:
 *  - agent.first_token_ms: latencia hasta el primer token emitido (SLO p95 < 2s).
 *  - agent.stream_duration_ms: duración completa de la conversación/stream.
 *  - agent.requests_total: volumen total por canal y estado.
 *  - agent.cancellations_total: tasa de cancelación por el cliente.
 *  - agent.errors_total: tasa de error (SLO error rate < 2%).
 *
 * Política estricta Anti-PII: los atributos solo admiten tenantId, canal,
 * flag de streaming y status. Se rechazan o descartan textos de mensajes o prompts.
 */

import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

export const METRIC_AGENT_FIRST_TOKEN_MS = 'agent.first_token_ms';
export const METRIC_AGENT_STREAM_DURATION_MS = 'agent.stream_duration_ms';
export const METRIC_AGENT_REQUESTS_TOTAL = 'agent.requests_total';
export const METRIC_AGENT_CANCELLATIONS_TOTAL = 'agent.cancellations_total';
export const METRIC_AGENT_ERRORS_TOTAL = 'agent.errors_total';

export const SLO_FIRST_TOKEN_P95_MS = 2000;
export const SLO_ERROR_RATE_MAX = 0.02;

export interface AgentMetricAttributes {
  channel: 'web' | 'android' | string;
  tenantId?: string;
  streaming: boolean;
  status?: 'success' | 'error' | 'cancelled';
}

export interface RecordedMetricEntry {
  metric: string;
  value: number;
  attributes: Record<string, string | number | boolean>;
  timestamp: number;
}

export class AgentMetrics {
  private static instance: AgentMetrics | null = null;
  private readonly meter = metrics.getMeter('mybusiness.agent');

  public readonly firstTokenHistogram: Histogram;
  public readonly streamDurationHistogram: Histogram;
  public readonly requestsCounter: Counter;
  public readonly cancellationsCounter: Counter;
  public readonly errorsCounter: Counter;

  // Buffer en memoria para pruebas, validación local y evaluación de SLOs
  private readonly recorded: RecordedMetricEntry[] = [];

  constructor() {
    this.firstTokenHistogram = this.meter.createHistogram(METRIC_AGENT_FIRST_TOKEN_MS, {
      description: 'Latencia hasta el primer token en milisegundos (SLO p95 < 2s)',
      unit: 'ms',
    });

    this.streamDurationHistogram = this.meter.createHistogram(METRIC_AGENT_STREAM_DURATION_MS, {
      description: 'Duración total de la respuesta del agente en milisegundos',
      unit: 'ms',
    });

    this.requestsCounter = this.meter.createCounter(METRIC_AGENT_REQUESTS_TOTAL, {
      description: 'Total de peticiones procesadas por el asistente',
    });

    this.cancellationsCounter = this.meter.createCounter(METRIC_AGENT_CANCELLATIONS_TOTAL, {
      description: 'Total de peticiones canceladas por el cliente',
    });

    this.errorsCounter = this.meter.createCounter(METRIC_AGENT_ERRORS_TOTAL, {
      description: 'Total de errores en conversaciones de agente (SLO < 2%)',
    });
  }

  public static getInstance(): AgentMetrics {
    if (!AgentMetrics.instance) {
      AgentMetrics.instance = new AgentMetrics();
    }
    return AgentMetrics.instance;
  }

  /**
   * Sanitiza atributos garantizando que NUNCA contengan texto de mensajes,
   * preguntas ni datos personales (Anti-PII).
   */
  public sanitizeAttributes(raw: AgentMetricAttributes): Record<string, string | number | boolean> {
    const clean: Record<string, string | number | boolean> = {
      channel: typeof raw.channel === 'string' ? raw.channel : 'web',
      streaming: Boolean(raw.streaming),
    };

    if (raw.tenantId && typeof raw.tenantId === 'string') {
      clean.tenantId = raw.tenantId;
    }

    if (raw.status) {
      clean.status = raw.status;
    }

    return clean;
  }

  /** Registra el tiempo hasta el primer token (con o sin streaming). */
  public recordFirstToken(durationMs: number, attributes: AgentMetricAttributes): void {
    const safeAttrs = this.sanitizeAttributes(attributes);
    this.firstTokenHistogram.record(durationMs, safeAttrs);
    this.recorded.push({
      metric: METRIC_AGENT_FIRST_TOKEN_MS,
      value: durationMs,
      attributes: safeAttrs,
      timestamp: Date.now(),
    });
  }

  /** Registra la duración completa del stream o procesamiento del mensaje. */
  public recordStreamDuration(durationMs: number, attributes: AgentMetricAttributes): void {
    const safeAttrs = this.sanitizeAttributes(attributes);
    this.streamDurationHistogram.record(durationMs, safeAttrs);
    this.recorded.push({
      metric: METRIC_AGENT_STREAM_DURATION_MS,
      value: durationMs,
      attributes: safeAttrs,
      timestamp: Date.now(),
    });
  }

  /** Registra una petición procesada exitosamente. */
  public recordRequest(attributes: AgentMetricAttributes): void {
    const safeAttrs = this.sanitizeAttributes({ ...attributes, status: 'success' });
    this.requestsCounter.add(1, safeAttrs);
    this.recorded.push({
      metric: METRIC_AGENT_REQUESTS_TOTAL,
      value: 1,
      attributes: safeAttrs,
      timestamp: Date.now(),
    });
  }

  /** Registra una cancelación del cliente (ej. AbortController / disconnect). */
  public recordCancellation(attributes: AgentMetricAttributes): void {
    const safeAttrs = this.sanitizeAttributes({ ...attributes, status: 'cancelled' });
    this.cancellationsCounter.add(1, safeAttrs);
    this.recorded.push({
      metric: METRIC_AGENT_CANCELLATIONS_TOTAL,
      value: 1,
      attributes: safeAttrs,
      timestamp: Date.now(),
    });
  }

  /** Registra un error de ejecución o fallo del proveedor. */
  public recordError(attributes: AgentMetricAttributes): void {
    const safeAttrs = this.sanitizeAttributes({ ...attributes, status: 'error' });
    this.errorsCounter.add(1, safeAttrs);
    this.recorded.push({
      metric: METRIC_AGENT_ERRORS_TOTAL,
      value: 1,
      attributes: safeAttrs,
      timestamp: Date.now(),
    });
  }

  /** Obtiene las métricas registradas en memoria (para aserciones de prueba). */
  public getRecordedMetrics(): RecordedMetricEntry[] {
    return [...this.recorded];
  }

  /** Limpia el búfer en memoria de métricas. */
  public clear(): void {
    this.recorded.length = 0;
  }

  /**
   * Evalúa el cumplimiento de SLOs sobre la muestra de métricas actual:
   *  - First token latency: p95 <= 2000 ms
   *  - Error rate: errors / total <= 2%
   */
  public evaluateSlos(channel?: string): {
    firstTokenP50Ms: number;
    firstTokenP95Ms: number;
    errorRate: number;
    firstTokenSloBreached: boolean;
    errorRateSloBreached: boolean;
  } {
    const filterFn = (m: RecordedMetricEntry) =>
      channel ? m.attributes.channel === channel : true;

    const firstTokenValues = this.recorded
      .filter((m) => m.metric === METRIC_AGENT_FIRST_TOKEN_MS && filterFn(m))
      .map((m) => m.value)
      .sort((a, b) => a - b);

    const p50 =
      firstTokenValues.length > 0
        ? (firstTokenValues[Math.floor(firstTokenValues.length * 0.5)] ?? 0)
        : 0;
    const p95 =
      firstTokenValues.length > 0
        ? (firstTokenValues[Math.floor(firstTokenValues.length * 0.95)] ?? 0)
        : 0;

    const totalRequests = this.recorded.filter(
      (m) => m.metric === METRIC_AGENT_REQUESTS_TOTAL && filterFn(m),
    ).length;
    const totalErrors = this.recorded.filter(
      (m) => m.metric === METRIC_AGENT_ERRORS_TOTAL && filterFn(m),
    ).length;

    const totalAttempts = totalRequests + totalErrors;
    const errorRate = totalAttempts > 0 ? totalErrors / totalAttempts : 0;

    return {
      firstTokenP50Ms: p50,
      firstTokenP95Ms: p95,
      errorRate,
      firstTokenSloBreached: p95 > SLO_FIRST_TOKEN_P95_MS,
      errorRateSloBreached: errorRate > SLO_ERROR_RATE_MAX,
    };
  }
}

export const agentMetrics = AgentMetrics.getInstance();

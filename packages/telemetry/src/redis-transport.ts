/**
 * Serializer/Deserializer de OpenTelemetry para el transporte Redis de
 * NestJS Microservices (SF3-07 / ADR-002: Redis Pub/Sub como transporte RPC).
 *
 * - Salida: inyecta el carrier W3C (traceparent/tracestate/baggage) en el payload.
 * - Entrada: retira la clave reservada del wire format y re-attacha el contexto a
 *   un símbolo no enumerable (ver `carrier.ts`), para que el handler y cualquier
 *   serialización posterior (logs, JSON, BD) no vean el carrier.
 *
 * Replican la semántica del stack por defecto de Nest 11 (IdentitySerializer al
 * escribir; passthrough de IncomingRequest/IncomingResponse al leer), por lo que
 * su uso es inofensivo incluso con la instrumentación desactivada.
 */
import type { Deserializer, Serializer } from '@nestjs/microservices';
import { injectRpcCarrier, takeAndAttachRpcCarrier } from './carrier';
/** Reemplaza a `IdentitySerializer`: identidad + inyección de carrier OTel en el payload. */
export class TelemetryRpcSerializer implements Serializer {
  serialize(value: unknown, _options?: Record<string, unknown>): unknown {
    if (
      value !== null &&
      typeof value === 'object' &&
      'data' in (value as Record<string, unknown>)
    ) {
      injectRpcCarrier((value as Record<string, unknown>)['data']);
    }
    return value;
  }
}

type DeserializerOptions = Record<string, unknown>;
type Envelope = Record<string, unknown>;

const ENVELOPE_KEYS: readonly string[] = ['err', 'response', 'isDisposed', 'pattern', 'data'];

/**
 * Reemplaza a `IncomingRequestDeserializer`/`IncomingResponseDeserializer`:
 * passthrough idéntico a Nest para envolventes `{id, pattern, data}` (solicitudes),
 * `{id, err, response}` (respuestas) y remapeo del esquema para mensajes "externos".
 */
export class TelemetryRpcDeserializer implements Deserializer {
  deserialize(value: unknown, options?: DeserializerOptions): unknown {
    const packet = this.passThrough(value, options);
    if (packet !== null && typeof packet === 'object') {
      takeAndAttachRpcCarrier((packet as Envelope)['data']);
    }
    return packet;
  }

  private passThrough(value: unknown, options?: DeserializerOptions): unknown {
    const channel = options?.['channel'];
    if (
      value === null ||
      value === undefined ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      if (channel !== undefined) {
        return { pattern: channel, data: undefined };
      }
      return {
        id: value as unknown,
        response: value,
        isDisposed: true,
      };
    }
    const record = value as Envelope;
    const looksLikeEnvelope = ENVELOPE_KEYS.some((key) => record[key] !== undefined);
    if (looksLikeEnvelope) {
      return record;
    }
    if (channel !== undefined) {
      return { pattern: channel, data: record };
    }
    return { id: record['id'], response: record, isDisposed: true };
  }
}

export interface TelemetryTransportOptions {
  serializer: Serializer;
  deserializer: Deserializer;
}

/** Adjunta los hooks de transporte OTel a unas opciones de transporte Redis de Nest. */
export function withTelemetryTransport<T extends object>(
  options: T,
): T & TelemetryTransportOptions {
  return {
    ...options,
    serializer: new TelemetryRpcSerializer(),
    deserializer: new TelemetryRpcDeserializer(),
  } as T & TelemetryTransportOptions;
}

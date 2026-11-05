/**
 * Transporte del contexto W3C por el bus Redis de NestJS Microservices (SF3-07).
 *
 * El "carrier" (traceparent/tracestate/baggage) viaja dentro del payload RPC bajo
 * la clave reservada `__otel`. En el extremo receptor, el deserializador elimina
 * la clave del wire format y re-attacha el contexto a un símbolo no enumerable en
 * el mismo objeto: no contamina logs, JSON ni persistencia, y evita carreras de
 * AsyncLocalStorage entre mensajes concurrentes (el carrier viaja con el mensaje).
 */
import { context, propagation } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';

/** Clave reservada en la que viaja el carrier dentro del payload RPC. */
export const RPC_CARRIER_WIRE_KEY = '__otel';

/** Símbolo en proceso (no enumerable, no serializable) para el contexto descargado. */
export const RPC_CARRIER_CONTEXT_SYMBOL: unique symbol = Symbol('mybusiness.otel.carrier');

const CARRIER_ALLOWED_KEYS: ReadonlySet<string> = new Set(['traceparent', 'tracestate', 'baggage']);

export type RpcCarrier = Record<string, string>;

/** Objeto que puede transportar un carrier (payload RPC serializable). */
export interface CarrierContainer {
  [key: string]: unknown;
  [RPC_CARRIER_CONTEXT_SYMBOL]?: RpcCarrier;
}

function isCarrierContainer(value: unknown): value is CarrierContainer {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

/** Solo pasan las claves de propagación W3C; cualquier otra se descarta. */
function sanitizeCarrier(raw: unknown): RpcCarrier | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as CarrierContainer;
  const carrier: RpcCarrier = {};
  for (const key of Object.keys(record)) {
    if (CARRIER_ALLOWED_KEYS.has(key) && typeof record[key] === 'string') {
      carrier[key] = record[key] as string;
    }
  }
  return Object.keys(carrier).length === 0 ? undefined : carrier;
}

/**
 * Inyecta el contexto activo actual (traceparent/tracestate/baggage) en el payload.
 * No-op si el payload no es un objeto o si no hay contexto con propagación activa.
 */
export function injectRpcCarrier(data: unknown): void {
  if (!isCarrierContainer(data)) {
    return;
  }
  const carrier: RpcCarrier = {};
  propagation.inject(context.active(), carrier);
  if (Object.keys(carrier).length === 0) {
    return;
  }
  data[RPC_CARRIER_WIRE_KEY] = carrier;
}

/**
 * Extrae el carrier del wire format del payload y lo re-attacha como
 * símbolo no enumerable. La clave `__otel` desaparece del objeto en adelante.
 */
export function takeAndAttachRpcCarrier(data: unknown): void {
  if (!isCarrierContainer(data)) {
    return;
  }
  const raw = data[RPC_CARRIER_WIRE_KEY];

  delete data[RPC_CARRIER_WIRE_KEY];
  const carrier = sanitizeCarrier(raw);
  if (!carrier) {
    return;
  }
  // No enumerable para que no viaje en spreads/JSON; configurable para re-attach seguros.
  Object.defineProperty(data, RPC_CARRIER_CONTEXT_SYMBOL, {
    value: carrier,
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/**
 * Lee el contexto descargado de un payload y lo materializa como Context W3C
 * (application: ROOT_CONTEXT + traceparent + baggage). Devuelve undefined si el
 * payload no fue decorado con un carrier.
 */
export function peekRpcCarrierContext(data: unknown): Context | undefined {
  if (!isCarrierContainer(data)) {
    return undefined;
  }
  const carrier = sanitizeCarrier(data[RPC_CARRIER_CONTEXT_SYMBOL]);
  if (!carrier) {
    return undefined;
  }
  return propagation.extract(context.active(), carrier);
}

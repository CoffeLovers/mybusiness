/**
 * IntegraciÃ³n end-to-end del transporte del carrier por el bus Redis (SF3-07):
 * serializador (emisor) â†’ wire JSON â†’ deserializador (receptor) â†’ contexto W3C.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Context, Span, SpanContext } from '@opentelemetry/api';
import { ROOT_CONTEXT, context, propagation, trace } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { RPC_CARRIER_WIRE_KEY, injectRpcCarrier, peekRpcCarrierContext } from '../src/carrier';
import { TelemetryRpcDeserializer, TelemetryRpcSerializer } from '../src/redis-transport';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

/** Span no-grabador mínimo: propagation solo necesita `spanContext()`. */
function fakeSpan(spanContext: SpanContext): Span {
  return {
    spanContext: () => spanContext,
    end: () => undefined,
    setAttribute: () => fakeSpan(spanContext),
  } as unknown as Span;
}

const serializer = new TelemetryRpcSerializer();
const deserializer = new TelemetryRpcDeserializer();

let contextManager: AsyncLocalStorageContextManager;

beforeAll(() => {
  contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  // Replicar los propagadores que NodeSDK registra en producción.
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
});

afterAll(() => {
  context.disable();
});

function wireRoundtrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('propagaciÃ³n del carrier en el transporte Redis', () => {
  it('inyecta traceparent + baggage desde el contexto activo', () => {
    const spanCtx = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: false };
    const span = fakeSpan(spanCtx);
    const withBaggage = propagation.setBaggage(
      trace.setSpan(ROOT_CONTEXT, span),
      propagation.createBaggage().setEntry('mybusiness.channel', { value: 'web' }),
    );

    const payload: Record<string, unknown> = {
      tenantId: 't_1',
      role: 'admin',
      data: 'NUNCA-EN-SPAN',
    };
    context.with(withBaggage, () => {
      serializer.serialize({ id: 'abc-1', pattern: 'finance.getLedger', data: payload });
    });

    const carrier = payload[RPC_CARRIER_WIRE_KEY] as Record<string, string>;
    expect(carrier['traceparent']).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    expect(carrier['baggage']).toContain('mybusiness.channel=web');
  });

  it('sin spans activos no inyecta nada (payload queda limpio)', () => {
    const payload: Record<string, unknown> = { tenantId: 't_1' };
    context.with(ROOT_CONTEXT, () =>
      serializer.serialize({ id: 'x', pattern: 'a', data: payload }),
    );
    expect(payload[RPC_CARRIER_WIRE_KEY]).toBeUndefined();
  });

  it('roundtrip: wire JSON â†’ deserializador retira el carrier del payload y mantiene passthrough', () => {
    const spanCtx = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: false };
    const span = fakeSpan(spanCtx);

    const payload: Record<string, unknown> = { tenantId: 't_1', role: 'owner' };
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      serializer.serialize({ id: 'abc-2', pattern: 'agent.chat', data: payload });
    });

    const wire = wireRoundtrip({ id: 'abc-2', pattern: 'agent.chat', data: payload }) as Record<
      string,
      unknown
    >;

    const packet = deserializer.deserialize(wire, { channel: 'agent.chat' }) as {
      id: string;
      data: Record<string, unknown>;
    };
    // Passthrough fiel a IncomingRequestDeserializer: id intacto, data estrecha.
    expect(packet.id).toBe('abc-2');
    expect(packet.data.tenantId).toBe('t_1');
    // La clave de wire `__otel` ya no existe en el payload (no contamina logs/BD).
    expect(packet.data[RPC_CARRIER_WIRE_KEY]).toBeUndefined();
  });

  it('el contexto descargado materializa el parentId del lado consumidor', () => {
    const spanCtx = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: false };
    const span = fakeSpan(spanCtx);

    const payload: Record<string, unknown> = { tenantId: 't_1' };
    const withChannel = propagation.setBaggage(
      trace.setSpan(ROOT_CONTEXT, fakeSpan(spanCtx)),
      propagation.createBaggage().setEntry('mybusiness.channel', { value: 'web' }),
    );
    context.with(withChannel, () => {
      serializer.serialize({ id: 'abc-3', pattern: 'chat', data: payload });
    });
    const wire = wireRoundtrip({ id: 'abc-3', pattern: 'chat', data: payload }) as Record<
      string,
      unknown
    >;
    const packet = deserializer.deserialize(wire, { channel: 'chat' }) as {
      data?: unknown;
    };

    const extracted: Context | undefined = peekRpcCarrierContext(packet['data']);
    expect(extracted).toBeDefined();
    const spanContext = trace.getSpanContext(extracted as Context);
    expect(spanContext).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 });
    const channel = propagation
      .getBaggage(extracted as Context)
      ?.getEntry('mybusiness.channel')?.value;
    expect(channel).toBe('web');
  });

  it('anti-PII: el carrier descarta claves fuera del contrato W3C', () => {
    const wire = {
      id: 'abc-4',
      pattern: 'chat',
      data: {
        email: 'user@example.test',
        message: 'contenido del usuario',
        __otel: {
          traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
          email: 'user@example.test',
          message: 'contenido del usuario',
        },
      },
    };

    const packet = deserializer.deserialize(wire, { channel: 'chat' }) as {
      data: Record<string, unknown>;
    };
    expect(packet.data['__otel']).toBeUndefined();
    const extracted = peekRpcCarrierContext(packet.data);
    expect(extracted).toBeDefined(); // traceparent sobreviviÃ³
    expect(packet.data['email']).toBe('user@example.test'); // payload de negocio intacto
  });

  it('respuestas del cliente (protocolo de Nest) pasan sin cambios (identity)', () => {
    const value = { id: 'abc-5', response: { ok: true } };
    const packet = deserializer.deserialize(wireRoundtrip(value)) as unknown;
    expect(packet).toEqual(value);
  });

  it('mensajes externos (sin envelope) se remapean al esquema del canal', () => {
    const packet = deserializer.deserialize({ foo: 'bar' }, { channel: 'evt.channel' }) as {
      pattern?: string;
      data?: unknown;
    };
    expect(packet.pattern).toBe('evt.channel');
    expect(packet.data).toEqual({ foo: 'bar' });
  });
});

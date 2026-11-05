/**
 * Interceptors Nest de OpenTelemetry para MyBusiness (SF3-07).
 *
 * - `HttpTelemetryAttributesInterceptor` (API Gateway): decora el span raíz HTTP
 *   con `tenantId`, `userRole` y `channel` (claims del JWT, sin PII) y los
 *   propaga por Baggage W3C hacia el bus Redis.
 * - `RpcTelemetryInterceptor` (microservicios): extrae el carrier del mensaje
 *   (`carrier.ts`), crea el span consumidor RPC y descarga los atributos de
 *   Baggage sobre el span.
 *
 * Regla anti-PII: solo IDs, roles y canal. Nunca bodies, emails ni contenido.
 */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Baggage, Tracer } from '@opentelemetry/api';
import { context, propagation, trace } from '@opentelemetry/api';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { Observable } from 'rxjs';
import { getTracer } from './trace';
import { peekRpcCarrierContext } from './carrier';
import { DEFAULT_CHANNEL } from './config/telemetry-config';
import { isTelemetryActive } from './lifecycle';

export const SPAN_ATTR_TENANT_ID = 'tenantId';
export const SPAN_ATTR_USER_ROLE = 'userRole';
export const SPAN_ATTR_CHANNEL = 'channel';
/** Clave semántica para el patrón/canal del mensaje RPC. */
export const SPAN_ATTR_RPC_PATTERN = 'mybusiness.rpc_pattern';
export const SPAN_ATTR_MESSAGING_SYSTEM = 'messaging.system';

const BAGGAGE_KEYS = {
  tenantId: 'mybusiness.tenant_id',
  userRole: 'mybusiness.user_role',
  channel: 'mybusiness.channel',
} as const;

interface TelemetryClaims {
  readonly tenantId?: unknown;
  readonly userId?: unknown;
  readonly role?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

interface BracketEntry {
  readonly key: string;
  readonly value: { readonly value: string };
}

function setBaggageEntries(
  baggage: Baggage | undefined,
  entries: readonly BracketEntry[],
): Baggage {
  let next = baggage ?? propagation.createBaggage();
  for (const { key, value } of entries) {
    next = next.setEntry(key, value);
  }
  return next;
}

interface HttpRequestLike {
  readonly user?: TelemetryClaims;
  readonly headers?: Record<string, unknown>;
}

@Injectable()
export class HttpTelemetryAttributesInterceptor implements NestInterceptor {
  intercept(execContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!isTelemetryActive()) {
      return next.handle();
    }
    const request = execContext.switchToHttp().getRequest<HttpRequestLike>();
    if (!request) {
      return next.handle();
    }

    const activeCtx = context.active();
    const rootSpan = trace.getSpan(activeCtx);
    const tenantId = asString(request.user?.tenantId);
    const userRole = asString(request.user?.role);
    const channelHeader = request.headers?.['x-mybusiness-channel'];
    const channel = asString(channelHeader) ?? DEFAULT_CHANNEL;

    if (rootSpan) {
      if (tenantId !== undefined) {
        rootSpan.setAttribute(SPAN_ATTR_TENANT_ID, tenantId);
      }
      if (userRole !== undefined) {
        rootSpan.setAttribute(SPAN_ATTR_USER_ROLE, userRole);
      }
      rootSpan.setAttribute(SPAN_ATTR_CHANNEL, channel);
    }

    const baggage = setBaggageEntries(propagation.getBaggage(activeCtx), [
      { key: BAGGAGE_KEYS.channel, value: { value: channel } },
      ...(tenantId !== undefined
        ? [{ key: BAGGAGE_KEYS.tenantId, value: { value: tenantId } }]
        : []),
      ...(userRole !== undefined
        ? [{ key: BAGGAGE_KEYS.userRole, value: { value: userRole } }]
        : []),
    ]);

    return new Observable((subscriber) =>
      context.with(propagation.setBaggage(activeCtx, baggage), () =>
        next.handle().subscribe({
          next: (value: unknown) => subscriber.next(value),
          error: (reason: unknown) => subscriber.error(reason),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}

interface RpcEnvelopeLike {
  readonly tenantId?: unknown;
  readonly role?: unknown;
}

@Injectable()
export class RpcTelemetryInterceptor implements NestInterceptor {
  private readonly tracer: Tracer = getTracer('@mybusiness/telemetry');

  intercept(execContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!isTelemetryActive() || execContext.getType<string>() !== 'rpc') {
      return next.handle();
    }

    let payload: unknown;
    try {
      payload = execContext.switchToRpc().getData();
    } catch {
      return next.handle();
    }

    const parentContext = peekRpcCarrierContext(payload) ?? context.active();

    // Atributos del span consumidor: tenantId/role ya viajan en el payload RPC
    // (contratos existentes); el canal llega por Baggage en el carrier.
    const envelope = (payload ?? {}) as RpcEnvelopeLike;
    const tenantId = asString(envelope.tenantId);
    const userRole = asString(envelope.role);
    const channel =
      propagation.getBaggage(parentContext)?.getEntry(BAGGAGE_KEYS.channel)?.value ?? 'rpc';
    const pattern = readRpcPattern(execContext) ?? 'rpc.call';

    const span = this.tracer.startSpan(pattern, { kind: SpanKind.CONSUMER }, parentContext);
    if (tenantId !== undefined) {
      span.setAttribute(SPAN_ATTR_TENANT_ID, tenantId);
    }
    if (userRole !== undefined) {
      span.setAttribute(SPAN_ATTR_USER_ROLE, userRole);
    }
    span.setAttribute(SPAN_ATTR_CHANNEL, channel);
    span.setAttribute(SPAN_ATTR_MESSAGING_SYSTEM, 'redis');
    span.setAttribute(SPAN_ATTR_RPC_PATTERN, pattern);

    const spanContext = trace.setSpan(parentContext, span);

    return new Observable((subscriber) =>
      context.with(spanContext, () => {
        const subscription = next.handle().subscribe({
          next: (value: unknown) => subscriber.next(value),
          error: (reason: unknown) => {
            span.recordException(reason as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            subscriber.error(reason);
          },
          complete: () => {
            span.end();
            subscriber.complete();
          },
        });
        return () => subscription.unsubscribe();
      }),
    );
  }
}

function readRpcPattern(execContext: ExecutionContext): string | undefined {
  try {
    const redisCtx = execContext.switchToRpc().getContext() as unknown;
    if (redisCtx !== null && typeof redisCtx === 'object') {
      const args = (redisCtx as { readonly args?: readonly unknown[] }).args;
      const raw = args?.[0];
      if (typeof raw === 'string') {
        return raw;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

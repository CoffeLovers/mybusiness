/**
 * Unit: interceptors Nest de telemetría (guard de wiring y conducta con SDK off).
 * El lifecycle es global: con OTEL_ENABLED ausente, isTelemetryActive() === false
 * y los interceptors deben comportarse como passthrough puro.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { HttpTelemetryAttributesInterceptor, RpcTelemetryInterceptor } from '../src/interceptors';
import { isTelemetryActive } from '../src/lifecycle';

function fakeHttpClient(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { tenantId: 't_1', role: 'owner' }, headers: {} }),
      getResponse: () => ({}),
    }),
    getType: () => 'http',
    getArgs: () => [],
    getClass: () => ({}),
    getHandler: () => ({}),
    switchToRpc: () => {
      throw new Error('rpc inesperado');
    },
    switchToWs: () => {
      throw new Error('ws inesperado');
    },
  } as unknown as ExecutionContext;
}

describe('guard de wiring: el SDK nunca arranca en tests/builds sin entorno', () => {
  it('isTelemetryActive es false por defecto', () => {
    expect(isTelemetryActive()).toBe(false);
  });

  it('HttpTelemetryAttributesInterceptor: passthrough sin tocar la request', () => {
    const interceptor = new HttpTelemetryAttributesInterceptor();
    const requestSpy = { user: { tenantId: 't_1', role: 'owner' }, headers: {} };
    const execContext = {
      switchToHttp: () => ({ getRequest: () => requestSpy }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
    const result = interceptor.intercept(execContext, {
      handle: () => of('ok'),
    } as unknown as CallHandler);
    let observed: string | undefined;
    result.subscribe((v) => {
      observed = v as string;
    });
    expect(observed).toBe('ok');
  });

  it('RpcTelemetryInterceptor: passthrough sin spans cuando el SDK está off', () => {
    const interceptor = new RpcTelemetryInterceptor();
    const execContext = {
      getType: () => 'rpc',
      switchToRpc: () => ({
        getData: () => ({ __otel: { traceparent: 'set-none' } }),
      }),
    } as unknown as ExecutionContext;
    const spy = vi.fn(() => of('ok'));
    const result = interceptor.intercept(execContext, { handle: spy } as unknown as CallHandler);
    let observed: string | undefined;
    result.subscribe((v) => {
      observed = v as string;
    });
    expect(observed).toBe('ok');
    expect(spy).toHaveBeenCalledOnce(); // ejecutado sin spans ni tapas extra
  });

  it('consume observables reales para retornar (contrato de interceptores Nest)', () => {
    const interceptor = new HttpTelemetryAttributesInterceptor();
    const execContext = {
      switchToHttp: () => ({ getRequest: () => undefined }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
    const handle = interceptor.intercept(execContext, { handle: () => of(1) } as CallHandler);
    let emitted = false;
    handle.subscribe(() => {
      emitted = true;
    });
    expect(emitted).toBe(true);
  });
});

describe('fakeHttpClient', () => {
  it('retorna http execution context utilizable por interceptores', () => {
    const ctx = fakeHttpClient();
    expect(ctx.getType()).toBe('http');
  });
});

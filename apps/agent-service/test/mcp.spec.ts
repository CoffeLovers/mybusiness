import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of, throwError, TimeoutError } from 'rxjs';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import type { ConfigService } from '@nestjs/config';
import {
  AuditEvents,
  CashflowPatterns,
  LedgerPatterns,
  MCP_PROTOCOL_VERSION,
  McpErrorCodes,
  McpPatterns,
  PaymentsPatterns,
  UserRole,
  type McpJsonRpcResponse,
  type McpJsonRpcRequest,
  type McpToolName,
  type McpToolsListResult,
  type WithContext,
} from '@mybusiness/contracts';
import { McpController } from '../src/mcp/mcp.controller';
import { McpToolsService, type RateLimiter } from '../src/mcp/mcp-tools.service';
import { McpAuditPublisher } from '../src/mcp/mcp-audit.publisher';
import { MCP_TOOLS } from '../src/mcp/tool-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLE: UserRole = 'ADMIN';
interface Harness {
  controller: McpController;
  service: McpToolsService;
  send: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
}

function createHarness(
  options: {
    allowed?: boolean;
    consumeRejects?: Error;
    publishRejects?: Error;
    rateLimit?: string | number;
  } = {},
): Harness {
  const send = vi.fn();
  const publish = options.publishRejects
    ? vi.fn().mockRejectedValue(options.publishRejects)
    : vi.fn().mockResolvedValue(undefined);
  const consume = options.consumeRejects
    ? vi.fn().mockRejectedValue(options.consumeRejects)
    : vi.fn().mockResolvedValue(options.allowed ?? true);

  const financeClient = { send } as unknown as ClientProxy;
  const auditPublisher = { publish } as unknown as McpAuditPublisher;
  const config = {
    get: (_key: string, defaultValue?: unknown) =>
      options.rateLimit !== undefined ? options.rateLimit : defaultValue,
  } as unknown as ConfigService;
  const limiter: RateLimiter = { consume };

  const service = new McpToolsService(financeClient, auditPublisher, config, limiter);
  return { controller: new McpController(service), service, send, publish, consume };
}

function rpc(
  method: string,
  params?: unknown,
  id: string | number | null = 1,
): WithContext<McpJsonRpcRequest> {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: ROLE,
  };
}

function callTool(name: string, args: Record<string, unknown>) {
  return rpc('tools/call', { name, arguments: args });
}

/** Igual que `callTool` pero con un rol explícito (el sobre lo resuelve el servidor). */
function callToolAs(name: string, args: Record<string, unknown>, role: string) {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
    tenantId: TENANT_ID,
    userId: USER_ID,
    role,
  };
}

function expectFailure(response: McpJsonRpcResponse): {
  code: number;
  message: string;
  data?: { code: string };
} {
  if (!('error' in response)) {
    throw new Error(`Se esperaba un error JSON-RPC, se recibió: ${JSON.stringify(response)}`);
  }
  return response.error;
}

describe('McpController', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('initialize devuelve el protocolo y las capacidades del servidor', async () => {
    const response = await harness.controller.handle(rpc('initialize'));

    expect('result' in response).toBe(true);
    const result = (response as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo).toEqual(
      expect.objectContaining({ name: expect.any(String), version: expect.any(String) }),
    );
  });

  it('tools/list expone las 3 herramientas con additionalProperties:false', async () => {
    const response = await harness.controller.handle(rpc('tools/list'));

    const result = (response as { result: McpToolsListResult }).result;
    expect(result.tools).toHaveLength(3);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'get_cashflow_summary',
      'list_unreconciled_transactions',
      'create_payment_link',
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.type).toBe('object');
    }
    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('ejecuta get_cashflow_summary con el contexto del servidor y sin campos extra', async () => {
    harness.send.mockReturnValue(of({ income: 100, expenses: 40, net: 60 }));

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31', currency: 'usd' }),
    );

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledWith(CashflowPatterns.SUMMARY, {
      from: '2026-01-01',
      to: '2026-01-31',
      currency: 'USD',
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
    });
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tool: 'get_cashflow_summary',
        schemaVersion: '1.0.0',
        data: { income: 100, expenses: 40, net: 60 },
      },
    });
  });

  it('rechaza argumentos con campos desconocidos sin invocar a finance-service', async () => {
    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', {
        from: '2026-01-01',
        to: '2026-01-31',
        tenantId: 'tenant-inyectado',
      }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_INVALID_INPUT);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('fuerza reconciliationStatus UNMATCHED en list_unreconciled_transactions', async () => {
    harness.send.mockReturnValue(of({ items: [], total: 0 }));

    const response = await harness.controller.handle(
      callTool('list_unreconciled_transactions', { page: 2, pageSize: 50 }),
    );

    expect(harness.send).toHaveBeenCalledWith(LedgerPatterns.LIST, {
      page: 2,
      pageSize: 50,
      reconciliationStatus: 'UNMATCHED',
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
    });
    expect('result' in response).toBe(true);
  });

  it('rechaza list_unreconciled_transactions con pageSize fuera de rango', async () => {
    const response = await harness.controller.handle(
      callTool('list_unreconciled_transactions', { pageSize: 500 }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_INVALID_INPUT);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('mapea el timeout del RPC a TOOL_TIMEOUT', async () => {
    harness.send.mockReturnValue(throwError(() => new TimeoutError()));

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_TIMEOUT);
  });

  it('bloquea la invocación cuando se excede el rate limit del tenant', async () => {
    harness = createHarness({ allowed: false });

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.RATE_LIMITED);
    expect(harness.consume).toHaveBeenCalledWith(`mcp:${TENANT_ID}`);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('responde METHOD_NOT_FOUND a métodos desconocidos', async () => {
    const response = await harness.controller.handle(rpc('resources/list'));

    expect(expectFailure(response).code).toBe(McpErrorCodes.METHOD_NOT_FOUND);
  });

  it('create_payment_link crea la orden con contexto autorizado y devuelve el link', async () => {
    harness.send.mockReturnValue(
      of({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: TENANT_ID,
        invoiceRef: INVOICE_ID,
        paypalOrderId: 'PAYPAL-123',
        status: 'CREATED',
        amountMinor: '250000',
        currency: 'COP',
        checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    const response = await harness.controller.handle(
      callToolAs(
        'create_payment_link',
        { amountMinor: '250000', currency: 'cop', invoiceId: INVOICE_ID },
        UserRole.ACCOUNTANT,
      ),
    );

    expect(harness.send).toHaveBeenCalledWith(
      PaymentsPatterns.PAYPAL_CREATE_ORDER,
      expect.objectContaining({
        amountMinor: '250000',
        currency: 'COP',
        invoiceRef: INVOICE_ID,
        idempotencyKey: expect.stringMatching(UUID_PATTERN) as string,
        tenantId: TENANT_ID,
        userId: USER_ID,
      }),
    );
    expect('result' in response).toBe(true);
    const result = (response as { result: { data: Record<string, unknown> } }).result.data;
    expect(result).toEqual({
      paypalOrderId: 'PAYPAL-123',
      status: 'CREATED',
      checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123',
      amountMinor: '250000',
      currency: 'COP',
    });
  });

  it('create_payment_link respeta la clave de idempotencia del agente cuando la provee', async () => {
    harness.send.mockReturnValue(
      of({
        id: 'a',
        paypalOrderId: 'P',
        status: 'CREATED',
        checkoutUrl: 'https://x/y',
        amountMinor: '1',
        currency: 'USD',
      }),
    );

    await harness.controller.handle(
      callToolAs(
        'create_payment_link',
        {
          amountMinor: '1000',
          currency: 'USD',
          invoiceId: INVOICE_ID,
          idempotencyKey: 'agent-key-123',
        },
        UserRole.ACCOUNTANT,
      ),
    );

    expect(harness.send).toHaveBeenCalledWith(
      PaymentsPatterns.PAYPAL_CREATE_ORDER,
      expect.objectContaining({ idempotencyKey: 'agent-key-123' }),
    );
  });

  it.each(['12.5', '0', '-100', 2500])(
    'create_payment_link rechaza floats/números/decimales (%p) con TOOL_INVALID_INPUT',
    async (amountMinor) => {
      const response = await harness.controller.handle(
        callTool('create_payment_link', { amountMinor, currency: 'COP', invoiceId: INVOICE_ID }),
      );

      expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_INVALID_INPUT);
      expect(harness.send).not.toHaveBeenCalled();
    },
  );

  it('create_payment_link sin clave genera UUID servidor-side y NO hace replay entre invocaciones con el mismo JSON-RPC id', async () => {
    harness.send.mockReturnValue(
      of({
        id: 'a',
        paypalOrderId: 'P',
        status: 'CREATED',
        checkoutUrl: 'https://x/y',
        amountMinor: '1',
        currency: 'USD',
      }),
    );

    // Ambas invocaciones comparten el mismo `id` JSON-RPC (1) y no proveen
    // idempotencyKey: deben producir claves servidor-side distintas, nunca una
    // colisión en UNIQUE (tenant_id, idempotency_key) que replaye una orden ajena.
    await harness.controller.handle(
      callToolAs(
        'create_payment_link',
        { amountMinor: '1000', currency: 'COP', invoiceId: INVOICE_ID },
        UserRole.ACCOUNTANT,
      ),
    );
    await harness.controller.handle(
      callToolAs(
        'create_payment_link',
        { amountMinor: '2000', currency: 'USD', invoiceId: INVOICE_ID },
        UserRole.ACCOUNTANT,
      ),
    );

    expect(harness.send).toHaveBeenCalledTimes(2);
    const [, firstPayload] = harness.send.mock.calls[0];
    const [, secondPayload] = harness.send.mock.calls[1];
    expect(firstPayload.idempotencyKey).toMatch(UUID_PATTERN);
    expect(secondPayload.idempotencyKey).toMatch(UUID_PATTERN);
    expect(firstPayload.idempotencyKey).not.toBe(secondPayload.idempotencyKey);

    // Idempotentemente, cada una creó su propia orden: no hay deduplicación cruzada.
    expect(firstPayload.amountMinor).toBe('1000');
    expect(secondPayload.amountMinor).toBe('2000');
  });

  it('create_payment_link rechaza una clave de idempotencia mayor a 255 caracteres', async () => {
    const response = await harness.controller.handle(
      callToolAs(
        'create_payment_link',
        {
          amountMinor: '1000',
          currency: 'COP',
          invoiceId: INVOICE_ID,
          idempotencyKey: 'k'.repeat(256),
        },
        UserRole.ACCOUNTANT,
      ),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_INVALID_INPUT);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('create_payment_link exige permiso de cobro incluso con contexto válido', async () => {
    // El rol del sobre por defecto (ADMIN) no está en la matriz payments:write.
    const response = await harness.controller.handle(
      callTool('create_payment_link', {
        amountMinor: '1000',
        currency: 'USD',
        invoiceId: INVOICE_ID,
      }),
    );

    expect('result' in response).toBe(false);
    const failure = (response as { error: { code: number; message: string } }).error;
    expect(failure.code).toBe(-32000);
    expect(failure.message).toContain('autorizado');
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('responde INVALID_PARAMS cuando tools/call recibe una herramienta desconocida', async () => {
    const response = await harness.controller.handle(callTool('delete_everything', {}));

    expect(expectFailure(response).code).toBe(McpErrorCodes.INVALID_PARAMS);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('responde INVALID_REQUEST si el payload no es JSON-RPC 2.0', async () => {
    const response = await harness.controller.handle({
      ...rpc('initialize'),
      jsonrpc: '1.0',
    } as unknown as WithContext<McpJsonRpcRequest>);

    expect(expectFailure(response).code).toBe(McpErrorCodes.INVALID_REQUEST);
  });

  it('no filtra argumentos ni tenantId en las respuestas de error', async () => {
    harness.send.mockReturnValue(throwError(() => new TimeoutError()));

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', {
        from: '2026-01-01',
        to: '2026-01-31',
        currency: 'EUR',
      }),
    );
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('2026-01-01');
    expect(serialized).not.toContain('EUR');
    expect(serialized).not.toContain(TENANT_ID);
    expect(serialized).not.toContain('at ');
  });
});

describe('McpToolsService auditoría', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('publica exactamente un evento de auditoría en una invocación exitosa', async () => {
    harness.send.mockReturnValue(of({ net: 10 }));

    await harness.service.call(
      'get_cashflow_summary',
      { from: '2026-01-01', to: '2026-01-31' },
      { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-1' },
    );

    expect(harness.publish).toHaveBeenCalledTimes(1);
    expect(harness.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        userId: USER_ID,
        role: ROLE,
        tool: 'get_cashflow_summary',
        ok: true,
        errorCode: undefined,
      }),
    );
  });

  it('publica exactamente un evento de auditoría con entrada inválida', async () => {
    await expect(
      harness.service.call(
        'get_cashflow_summary',
        { from: 'no-es-fecha', to: '2026-01-31' },
        { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-2' },
      ),
    ).rejects.toMatchObject({ code: McpErrorCodes.TOOL_INVALID_INPUT });

    expect(harness.publish).toHaveBeenCalledTimes(1);
    expect(harness.publish).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, errorCode: McpErrorCodes.TOOL_INVALID_INPUT }),
    );
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('publica exactamente un evento de auditoría en timeout', async () => {
    harness.send.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(
      harness.service.call(
        'get_cashflow_summary',
        { from: '2026-01-01', to: '2026-01-31' },
        { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-3' },
      ),
    ).rejects.toMatchObject({ code: McpErrorCodes.TOOL_TIMEOUT, httpStatus: 504 });

    expect(harness.publish).toHaveBeenCalledTimes(1);
    expect(harness.publish).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, errorCode: McpErrorCodes.TOOL_TIMEOUT }),
    );
  });

  it('publica exactamente un evento de auditoría al exceder el rate limit', async () => {
    harness = createHarness({ allowed: false });

    await expect(
      harness.service.call(
        'get_cashflow_summary',
        { from: '2026-01-01', to: '2026-01-31' },
        { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-4' },
      ),
    ).rejects.toMatchObject({ code: McpErrorCodes.RATE_LIMITED, httpStatus: 429 });

    expect(harness.publish).toHaveBeenCalledTimes(1);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('no publica eventos con argumentos ni datos del tenant más allá del contexto', async () => {
    harness.send.mockReturnValue(throwError(() => new TimeoutError()));

    await harness.service
      .call(
        'get_cashflow_summary',
        { from: '2026-01-01', to: '2026-01-31' },
        { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-5' },
      )
      .catch(() => undefined);

    const [event] = harness.publish.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(event).sort()).toEqual(
      ['errorCode', 'latencyMs', 'ok', 'resultSize', 'role', 'tenantId', 'tool', 'userId'].sort(),
    );
  });

  it('listTools devuelve el catálogo versionado', async () => {
    const result = await harness.service.listTools();
    expect(result.tools).toEqual(MCP_TOOLS);
    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('cada herramienta declarada es invocable por nombre', () => {
    const names: McpToolName[] = MCP_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([
      'get_cashflow_summary',
      'list_unreconciled_transactions',
      'create_payment_link',
    ]);
    expect(McpPatterns.RPC).toBe('mcp.rpc');
  });
});

describe('McpController validación de solicitudes', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it.each([
    ['method no es string', { ...rpc('initialize'), method: 42 }],
    ['id no es string ni número', { ...rpc('initialize'), id: { nested: true } }],
  ])('responde INVALID_REQUEST cuando %s', async (_label, payload) => {
    const response = await harness.controller.handle(
      payload as unknown as WithContext<McpJsonRpcRequest>,
    );

    expect(expectFailure(response).code).toBe(McpErrorCodes.INVALID_REQUEST);
  });

  it('responde INVALID_REQUEST con id null cuando el payload no es un objeto', async () => {
    const response = await harness.controller.handle(
      null as unknown as WithContext<McpJsonRpcRequest>,
    );

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBeNull();
    expect(expectFailure(response).code).toBe(McpErrorCodes.INVALID_REQUEST);
  });

  it('initialize con id numérico devuelve el mismo id', async () => {
    const response = await harness.controller.handle(rpc('initialize', undefined, 7));

    expect(response.id).toBe(7);
    expect('result' in response).toBe(true);
  });

  it('initialize con id null responde con id null', async () => {
    const response = await harness.controller.handle(rpc('initialize', undefined, null));

    expect(response.id).toBeNull();
    expect('result' in response).toBe(true);
  });

  it('tools/list sin id genera un requestId interno y responde con id null', async () => {
    const response = await harness.controller.handle({
      jsonrpc: '2.0',
      method: 'tools/list',
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
    } as unknown as WithContext<McpJsonRpcRequest>);

    expect(response.id).toBeNull();
    const result = (response as { result: McpToolsListResult }).result;
    expect(result.tools).toHaveLength(3);
  });

  it.each([
    ['sin name', { arguments: {} }],
    ['arguments no es objeto', { name: 'get_cashflow_summary', arguments: 'no-objeto' }],
    ['params ausente', undefined],
  ])('responde INVALID_PARAMS cuando tools/call llega %s', async (_label, params) => {
    const response = await harness.controller.handle(
      rpc('tools/call', params as Record<string, unknown> | undefined),
    );

    expect(expectFailure(response).code).toBe(McpErrorCodes.INVALID_PARAMS);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('ejecuta tools/call sin arguments y aplica el objeto vacío', async () => {
    harness.send.mockReturnValue(of({ items: [] }));

    const response = await harness.controller.handle(
      rpc('tools/call', { name: 'list_unreconciled_transactions' }),
    );

    expect(harness.send).toHaveBeenCalledWith(
      LedgerPatterns.LIST,
      expect.objectContaining({ reconciliationStatus: 'UNMATCHED', tenantId: TENANT_ID }),
    );
    expect('result' in response).toBe(true);
  });

  it.each([
    ['403', new HttpException('forbidden', HttpStatus.FORBIDDEN), McpErrorCodes.TOOL_FORBIDDEN],
    [
      '500 del microservicio',
      { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'boom' },
      McpErrorCodes.TOOL_UNAVAILABLE,
    ],
    ['status no HTTP', { status: 999, message: 'raro' }, McpErrorCodes.TOOL_UNAVAILABLE],
    ['error inesperado', new Error('sin estado'), McpErrorCodes.TOOL_UNAVAILABLE],
  ])('mapea un fallo de finance (%s) a %s', async (_label, error, expected) => {
    harness.send.mockReturnValue(throwError(() => error));

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).code).toBe(-32000);
    expect(expectFailure(response).data?.code).toBe(expected);
  });

  it('mapea un HttpException 503 a TOOL_TIMEOUT', async () => {
    harness.send.mockReturnValue(
      throwError(() => new HttpException('no disponible', HttpStatus.SERVICE_UNAVAILABLE)),
    );

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.TOOL_TIMEOUT);
  });

  it('responde INTERNAL_ERROR si la auditoría rompe la invocación', async () => {
    harness = createHarness({ publishRejects: new Error('audit caído') });
    harness.send.mockReturnValue(of({ net: 1 }));

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).code).toBe(McpErrorCodes.INTERNAL_ERROR);
  });

  it('usa el límite por defecto cuando la configuración no es numérica', async () => {
    harness = createHarness({ rateLimit: 'no-numérico', allowed: false });

    const response = await harness.controller.handle(
      callTool('get_cashflow_summary', { from: '2026-01-01', to: '2026-01-31' }),
    );

    expect(expectFailure(response).data?.code).toBe(McpErrorCodes.RATE_LIMITED);
  });
});

describe('McpToolsService tolerancia a fallos', () => {
  it('continúa sin cuota si el limitador lanza (fail-open)', async () => {
    const harness = createHarness({ consumeRejects: new Error('limiter caído') });
    harness.send.mockReturnValue(of({ net: 5 }));

    const result = await harness.service.call(
      'get_cashflow_summary',
      { from: '2026-01-01', to: '2026-01-31' },
      { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-6' },
    );

    expect(result.data).toEqual({ net: 5 });
    expect(harness.publish).toHaveBeenCalledTimes(1);
  });

  it('calcula resultSize cuando la herramienta devuelve un array', async () => {
    const harness = createHarness();
    harness.send.mockReturnValue(of([{ id: 1 }, { id: 2 }]));

    await harness.service.call(
      'list_unreconciled_transactions',
      {},
      { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-7' },
    );

    expect(harness.publish).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, resultSize: 2 }),
    );
  });

  it('deja resultSize indefinido cuando el resultado no es colección', async () => {
    const harness = createHarness();
    harness.send.mockReturnValue(of({ count: 3 }));

    await harness.service.call(
      'list_unreconciled_transactions',
      {},
      { tenantId: TENANT_ID, userId: USER_ID, role: ROLE, requestId: 'req-8' },
    );

    expect(harness.publish).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, resultSize: undefined }),
    );
  });
});

describe('McpAuditPublisher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function event(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
      tool: 'get_cashflow_summary',
      ok: true,
      latencyMs: 12,
      resultSize: 3,
      ...overrides,
    } as Parameters<McpAuditPublisher['publish']>[0];
  }

  it('emite un evento de auditoría con eventId UUID y sin argumentos de la herramienta', async () => {
    const emit = vi.fn().mockReturnValue(of(undefined));
    const publisher = new McpAuditPublisher({ emit } as unknown as ClientProxy);

    await publisher.publish(event());

    expect(emit).toHaveBeenCalledTimes(1);
    const [pattern, payload] = emit.mock.calls[0] as [string, Record<string, unknown>];
    expect(pattern).toBe(AuditEvents.LOG_EVENT);
    expect(payload).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
      action: 'mcp.tool.invoked',
      entityName: 'mcp_tool',
      entityId: 'get_cashflow_summary',
      newValues: { ok: true, latencyMs: 12, resultSize: 3 },
    });
    expect(payload.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof payload.timestamp).toBe('string');
  });

  it.each([
    ['un Error', new Error('bus caído'), 'Error'],
    ['un rechazo sin Error', 'string-rechazo', 'UnknownError'],
  ])('no lanza ni filtra datos cuando el bus falla con %s', async (_label, error, expectedName) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const emit = vi.fn().mockReturnValue(throwError(() => error));
    const publisher = new McpAuditPublisher({ emit } as unknown as ClientProxy);

    await expect(publisher.publish(event({ ok: false, errorCode: 'TOOL_TIMEOUT' }))).resolves.toBe(
      undefined,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const [[message]] = warn.mock.calls as [[string]];
    expect(message).toContain(expectedName);
    expect(message).not.toContain(TENANT_ID);
    expect(message).not.toContain('get_cashflow_summary');
    expect(message).not.toContain('TOOL_TIMEOUT');
  });
});

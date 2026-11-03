import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError, TimeoutError } from 'rxjs';
import type { ClientProxy } from '@nestjs/microservices';
import type { ConfigService } from '@nestjs/config';
import {
  CashflowPatterns,
  LedgerPatterns,
  MCP_PROTOCOL_VERSION,
  McpErrorCodes,
  McpPatterns,
  type McpJsonRpcResponse,
  type McpJsonRpcRequest,
  type McpToolName,
  type McpToolsListResult,
  type UserRole,
  type WithContext,
} from '@mybusiness/contracts';
import { McpController } from '../src/mcp/mcp.controller';
import { McpToolsService, type RateLimiter } from '../src/mcp/mcp-tools.service';
import type { McpAuditPublisher } from '../src/mcp/mcp-audit.publisher';
import { MCP_TOOLS } from '../src/mcp/tool-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE: UserRole = 'ADMIN';

interface Harness {
  controller: McpController;
  service: McpToolsService;
  send: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
}

function createHarness(options: { allowed?: boolean } = {}): Harness {
  const send = vi.fn();
  const publish = vi.fn().mockResolvedValue(undefined);
  const consume = vi.fn().mockResolvedValue(options.allowed ?? true);

  const financeClient = { send } as unknown as ClientProxy;
  const auditPublisher = { publish } as unknown as McpAuditPublisher;
  const config = {
    get: (_key: string, defaultValue?: unknown) => defaultValue,
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

  it('tools/list expone exactamente 2 herramientas de solo lectura con additionalProperties:false', async () => {
    const response = await harness.controller.handle(rpc('tools/list'));

    const result = (response as { result: McpToolsListResult }).result;
    expect(result.tools).toHaveLength(2);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'get_cashflow_summary',
      'list_unreconciled_transactions',
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
    expect(names).toEqual(['get_cashflow_summary', 'list_unreconciled_transactions']);
    expect(McpPatterns.RPC).toBe('mcp.rpc');
  });
});

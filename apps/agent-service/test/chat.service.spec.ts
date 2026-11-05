import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AgentDegradationReason,
  type AgentChatResponseDto,
  type McpCallToolResult,
  type McpInvocationContext,
  type McpToolName,
  type RequestContext,
  type SearchAgentMemoryResponse,
  type StoreAgentMemoryResponse,
  UserRole,
} from '@mybusiness/contracts';
import { ChatService, isGroundedAnswer } from '../src/chat/chat.service';
import { ChatModule, createLlmProvider } from '../src/chat/chat.module';
import { DeterministicLlmProvider, LLM_PROVIDER } from '../src/chat/llm-provider';
import { AgentService } from '../src/agent.service';
import { AgentMemoryModule } from '../src/agent-memory.module';
import { AgentServiceModule } from '../src/agent-service.module';
import { BudgetModule } from '../src/budget/budget.module';
import { BudgetService } from '../src/budget/budget.service';
import { McpModule } from '../src/mcp/mcp.module';
import { McpToolsService } from '../src/mcp/mcp-tools.service';
import { SemanticCacheModule } from '../src/cache/cache.module';
import { SemanticCacheService } from '../src/cache/semantic-cache.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE: UserRole = UserRole.ACCOUNTANT;

const CASHFLOW_QUESTION = '¿Cuál es el flujo de caja entre 2026-01-01 y 2026-01-31?';
const PERIOD = '2026-01-01/2026-01-31';

const CTX: RequestContext = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  role: ROLE,
};

const CASHFLOW_DATA = {
  currency: 'USD',
  balanceMinor: '100000',
  incomeMinor: '150000',
  expenseMinor: '50000',
};

interface MemoryEntry {
  id: string;
  content: string;
}

type SearchSimilarFn = (
  ctx: RequestContext,
  dto: { query: string; topK: number },
) => Promise<SearchAgentMemoryResponse>;

type StoreMemoryFn = (
  ctx: RequestContext,
  dto: { content: string; metadata?: Record<string, unknown> },
) => Promise<StoreAgentMemoryResponse>;

type ToolCallFn = (
  tool: McpToolName,
  args: Record<string, unknown>,
  ctx: McpInvocationContext,
) => Promise<McpCallToolResult>;

interface Harness {
  service: ChatService;
  provider: DeterministicLlmProvider;
  reserve: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  cacheGet: ReturnType<typeof vi.fn>;
  cacheSet: ReturnType<typeof vi.fn>;
  toolCall: Mock<ToolCallFn>;
  searchSimilar: Mock<SearchSimilarFn>;
  storeMemory: Mock<StoreMemoryFn>;
  /** Memoria indexada por tenant: emula el aislamiento multi-tenant. */
  memories: Map<string, MemoryEntry[]>;
}

interface HarnessOptions {
  granted?: boolean;
  delayMs?: number;
  mode?: 'grounded' | 'garbage';
  chatTimeoutMs?: number;
  /** Valor crudo de `AGENT_CHAT_TIMEOUT_MS` (permite valores no numéricos). */
  chatTimeoutValue?: number | string;
  /** Todas las herramientas MCP fallan. */
  toolFails?: boolean;
  /** La búsqueda en memoria falla. */
  memoryFails?: boolean;
  /** La persistencia de memoria falla. */
  storeMemoryFails?: boolean;
  /** La escritura en caché falla. */
  cacheSetFails?: boolean;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const reserve = vi.fn().mockResolvedValue({
    granted: options.granted ?? true,
    correlationId: 'corr-1',
    reservedMicroUsd: 100,
    remainingMicroUsd: 900,
  });
  const settle = vi.fn().mockResolvedValue({
    success: true,
    correlationId: 'corr-1',
    actualCostMicroUsd: 42,
    remainingMicroUsd: 858,
    settled: true,
    alreadySettled: false,
    consumption: {
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      costMicroUsd: 42,
      cacheHit: false,
      degraded: false,
      remainingMicroUsd: 858,
    },
  });
  const release = vi.fn().mockResolvedValue({
    success: true,
    correlationId: 'corr-1',
    releasedMicroUsd: 100,
    remainingMicroUsd: 900,
  });

  const cacheGet = vi.fn().mockResolvedValue({ hit: false });
  const cacheSet = options.cacheSetFails
    ? vi.fn().mockRejectedValue(new Error('redis no disponible'))
    : vi.fn().mockResolvedValue(undefined);

  const toolCall = vi.fn<ToolCallFn>(async (name: McpToolName): Promise<McpCallToolResult> => {
    if (options.toolFails) {
      throw new Error(`herramienta ${name} no disponible`);
    }
    return {
      tool: name,
      schemaVersion: '1.0.0',
      data: name === 'get_cashflow_summary' ? CASHFLOW_DATA : { rows: [], total: 0 },
    };
  });

  const memories = new Map<string, MemoryEntry[]>();

  const searchSimilar = vi.fn<SearchSimilarFn>(async (ctx, dto) => {
    if (options.memoryFails) {
      throw new Error('índice de memoria no disponible');
    }
    const stored = memories.get(ctx.tenantId) ?? [];
    return {
      query: dto.query,
      results: stored.slice(0, dto.topK).map((entry) => ({
        id: entry.id,
        content: entry.content,
        similarityScore: 0.99,
      })),
    };
  });

  const storeMemory = vi.fn<StoreMemoryFn>(async (ctx, dto) => {
    if (options.storeMemoryFails) {
      throw new Error('no se pudo persistir la memoria');
    }
    const stored = memories.get(ctx.tenantId) ?? [];
    const id = `mem-${stored.length + 1}`;
    stored.push({ id, content: dto.content });
    memories.set(ctx.tenantId, stored);
    return {
      id,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      content: dto.content,
      contextType: 'CONVERSATION_SUMMARY',
      metadata: dto.metadata ?? {},
      createdAt: new Date(),
      embeddingDimensions: 1536,
    };
  });

  const budget = {
    reserve,
    settle,
    release,
    estimateCost: vi.fn().mockReturnValue(100),
    calculateCost: vi.fn().mockReturnValue(42),
    handleDegradedResponse: vi.fn((reason: AgentDegradationReason) => ({
      degraded: true,
      reason,
      message: `respuesta degradada: ${reason}`,
      suggestions: [],
    })),
    getBudget: vi.fn().mockResolvedValue({ availableMicroUsd: 858 }),
  } as unknown as BudgetService;

  const cache = {
    get: cacheGet,
    set: cacheSet,
  } as unknown as SemanticCacheService;

  const mcp = { call: toolCall } as unknown as McpToolsService;
  const agent = { searchSimilar, storeMemory } as unknown as AgentService;

  const chatTimeoutValue = options.chatTimeoutValue ?? options.chatTimeoutMs ?? 8000;

  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'AGENT_CHAT_TIMEOUT_MS' ? chatTimeoutValue : fallback,
  } as unknown as ConfigService;

  const provider = new DeterministicLlmProvider({
    mode: options.mode ?? 'grounded',
    delayMs: options.delayMs ?? 0,
  });

  const service = new ChatService(budget, cache, mcp, agent, provider, config);

  return {
    service,
    provider,
    reserve,
    settle,
    release,
    cacheGet,
    cacheSet,
    toolCall,
    searchSimilar,
    storeMemory,
    memories,
  };
}

describe('ChatService — asistente conversacional determinista (#72)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('responde una pregunta de flujo de caja con la cita de la herramienta y su periodo', async () => {
    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain(PERIOD);
    expect(response.answer).toContain('150000');

    const toolCitation = response.citations.find((citation) => citation.source === 'tool');
    expect(toolCitation?.tool).toBe('get_cashflow_summary');
    expect(toolCitation?.period).toBe(PERIOD);

    expect(harness.toolCall).toHaveBeenCalledTimes(1);
    const [toolName, args, toolCtx] = harness.toolCall.mock.calls[0];
    expect(toolName).toBe('get_cashflow_summary');
    expect(args).toMatchObject({ from: '2026-01-01', to: '2026-01-31' });
    expect(toolCtx.tenantId).toBe(TENANT_ID);
    expect(toolCtx.userId).toBe(USER_ID);
    expect(toolCtx.role).toBe(ROLE);
  });

  it('descarta la respuesta del proveedor que inventa cifras y devuelve un grounded determinista', async () => {
    harness = createHarness({ mode: 'garbage' });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(true);
    expect(response.code).toBe('LLM_UNGROUNDED_NUMBER');
    expect(response.reason).toBe(AgentDegradationReason.PROVIDER_ERROR);

    expect(response.answer).not.toContain('9876543');
    expect(response.answer).not.toContain('7654321');
    expect(response.answer).not.toContain('654321');
    expect(response.answer).not.toContain('5555555');
    expect(response.answer).toContain('150000');

    // Las citas se conservan aunque la respuesta del LLM se descarte.
    expect(response.citations.some((citation) => citation.tool === 'get_cashflow_summary')).toBe(
      true,
    );
  });

  it('degrada con un código estable cuando el proveedor agota el tiempo de espera', async () => {
    harness = createHarness({ delayMs: 200, chatTimeoutMs: 10 });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(true);
    expect(response.code).toBe('LLM_TIMEOUT');
    expect(response.reason).toBe(AgentDegradationReason.PROVIDER_ERROR);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.settle).not.toHaveBeenCalled();
  });

  it('degrada con BUDGET_EXHAUSTED cuando la reserva no se concede', async () => {
    harness = createHarness({ granted: false });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(true);
    expect(response.reason).toBe(AgentDegradationReason.BUDGET_EXHAUSTED);
    expect(response.code).toBe('BUDGET_EXHAUSTED');
    expect(harness.toolCall).not.toHaveBeenCalled();
    expect(harness.cacheSet).not.toHaveBeenCalled();
  });

  it('usa el tenant del contexto en memoria, presupuesto y herramientas', async () => {
    await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(harness.reserve.mock.calls[0][0]).toMatchObject({ tenantId: TENANT_ID });
    expect(harness.searchSimilar.mock.calls[0][0]).toMatchObject({ tenantId: TENANT_ID });
    expect(harness.storeMemory.mock.calls[0][0]).toMatchObject({ tenantId: TENANT_ID });
  });

  it('ignora tenantId y userId inyectados en el payload y conserva el del contexto', async () => {
    const injected = {
      message: CASHFLOW_QUESTION,
      tenantId: OTHER_TENANT_ID,
      userId: '33333333-3333-4333-8333-333333333333',
    } as unknown as { message: string };

    const response = await harness.service.chat(CTX, injected);

    expect(response.degraded).toBe(false);
    expect(harness.reserve.mock.calls[0][0]).toMatchObject({ tenantId: TENANT_ID });
    expect(harness.searchSimilar.mock.calls[0][0]).toMatchObject({ tenantId: TENANT_ID });
    const [, , toolCtx] = harness.toolCall.mock.calls[0];
    expect(toolCtx.tenantId).toBe(TENANT_ID);
  });

  it('sirve la respuesta desde la caché semántica con cacheHit=true', async () => {
    const cached: AgentChatResponseDto = {
      answer: 'respuesta cacheada',
      citations: [],
      degraded: false,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        costMicroUsd: 0,
        budgetRemainingMicroUsd: 0,
        cacheHit: false,
      },
    };
    harness.cacheGet.mockResolvedValue({ hit: true, response: JSON.stringify(cached) });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.answer).toBe('respuesta cacheada');
    expect(response.usage.cacheHit).toBe(true);
    expect(harness.reserve).not.toHaveBeenCalled();
    expect(harness.toolCall).not.toHaveBeenCalled();
  });

  it('persiste la memoria de la conversación sin romper la respuesta', async () => {
    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(harness.storeMemory).toHaveBeenCalledTimes(1);
    expect(harness.storeMemory.mock.calls[0][1]).toMatchObject({ content: expect.any(String) });
    expect(harness.cacheSet).toHaveBeenCalledTimes(1);
    expect(harness.settle).toHaveBeenCalledTimes(1);
  });

  it('rechaza una conversación sin tenant en el contexto RPC', async () => {
    await expect(
      harness.service.chat({ ...CTX, tenantId: '' }, { message: CASHFLOW_QUESTION }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.toolCall).not.toHaveBeenCalled();
  });

  it('rechaza un mensaje vacío o solo con espacios', async () => {
    await expect(harness.service.chat(CTX, { message: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(harness.reserve).not.toHaveBeenCalled();
  });

  it('usa el timeout por defecto cuando la configuración no es un número válido', async () => {
    harness = createHarness({ chatTimeoutValue: 'no-es-un-numero', delayMs: 40 });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
  });
});

describe('ChatService — memoria del tenant y segunda pregunta', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('incluye citas de memoria y entrega los hechos de memoria al grounding del proveedor', async () => {
    harness.memories.set(TENANT_ID, [
      { id: 'mem-prev', content: 'El tenant concilia la cuenta bancaria cada mes.' },
    ]);
    const completeSpy = vi.spyOn(harness.provider, 'complete');

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);

    const memoryCitation = response.citations.find((citation) => citation.source === 'memory');
    expect(memoryCitation?.ref).toBe('mem-prev');
    expect(memoryCitation?.label).toBe('El tenant concilia la cuenta bancaria cada mes.');

    // El hecho de memoria llega al proveedor como evidencia explícita.
    const providerInput = completeSpy.mock.calls[0][0];
    const memoryFact = providerInput.facts.find((fact) => fact.source === 'memory');
    expect(memoryFact?.ref).toBe('mem-prev');
    expect(memoryFact?.label).toContain('concilia la cuenta bancaria');
    expect(response.answer).toContain('memoria previa del tenant');
  });

  it('reutiliza en una segunda pregunta la memoria del tenant correcto', async () => {
    harness.memories.set(OTHER_TENANT_ID, [
      { id: 'mem-otro-tenant', content: 'Memoria que no debe filtrarse.' },
    ]);

    const first = await harness.service.chat(CTX, {
      message: CASHFLOW_QUESTION,
      conversationId: 'conv-1',
    });
    expect(first.degraded).toBe(false);
    expect(harness.storeMemory).toHaveBeenCalledTimes(1);

    const second = await harness.service.chat(CTX, {
      message: '¿Y el detalle del mes pasado?',
      conversationId: 'conv-1',
    });

    expect(second.degraded).toBe(false);

    // La búsqueda se hace siempre con el tenant del contexto RPC.
    expect(harness.searchSimilar).toHaveBeenCalledTimes(2);
    for (const [ctx] of harness.searchSimilar.mock.calls) {
      expect(ctx.tenantId).toBe(TENANT_ID);
    }

    // La segunda pregunta reutiliza la memoria guardada por la primera.
    const memoryCitation = second.citations.find((citation) => citation.source === 'memory');
    expect(memoryCitation?.ref).toBe('mem-1');
    expect(memoryCitation?.label).toContain('¿Cuál es el flujo de caja');

    // La memoria de otro tenant nunca se mezcla.
    expect(second.citations.some((citation) => citation.ref === 'mem-otro-tenant')).toBe(false);
    expect(second.answer).not.toContain('Memoria que no debe filtrarse');
  });

  it('continúa la conversación sin memoria cuando la búsqueda de memoria falla', async () => {
    harness = createHarness({ memoryFails: true });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
    expect(response.citations.some((citation) => citation.source === 'memory')).toBe(false);
  });

  it('no rompe la respuesta cuando la persistencia de memoria falla', async () => {
    harness = createHarness({ storeMemoryFails: true });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
    expect(harness.settle).toHaveBeenCalledTimes(1);
  });
});

describe('ChatService — caché semántica tolerante a fallos', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('ignora una entrada de caché corrupta y responde con normalidad', async () => {
    harness.cacheGet.mockResolvedValue({ hit: true, response: '{esto-no-es-json' });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
    expect(harness.reserve).toHaveBeenCalledTimes(1);
    expect(harness.toolCall).toHaveBeenCalledTimes(1);
  });

  it('ignora una respuesta cacheada sin el campo answer', async () => {
    harness.cacheGet.mockResolvedValue({
      hit: true,
      response: JSON.stringify({ citations: [], degraded: false }),
    });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
    expect(harness.toolCall).toHaveBeenCalledTimes(1);
  });

  it('no rompe la respuesta cuando la lectura de caché falla', async () => {
    harness.cacheGet.mockRejectedValue(new Error('redis no disponible'));

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
  });

  it('no rompe la respuesta cuando la escritura en caché falla', async () => {
    harness = createHarness({ cacheSetFails: true });

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('150000');
    expect(harness.cacheSet).toHaveBeenCalledTimes(1);
  });
});

describe('ChatService — router determinista y envoltura del proveedor', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('enruta una pregunta de conciliación a list_unreconciled_transactions', async () => {
    const response = await harness.service.chat(CTX, {
      message: '¿Qué transacciones quedan pendientes de conciliación?',
    });

    expect(response.degraded).toBe(false);
    expect(harness.toolCall).toHaveBeenCalledTimes(1);
    const [toolName, args] = harness.toolCall.mock.calls[0];
    expect(toolName).toBe('list_unreconciled_transactions');
    // Sin fechas explícitas la herramienta no recibe periodo.
    expect(args).toEqual({});

    const toolCitation = response.citations.find((citation) => citation.source === 'tool');
    expect(toolCitation?.tool).toBe('list_unreconciled_transactions');
    expect(toolCitation?.period).toBeUndefined();
  });

  it('envía las fechas explícitas a la herramienta de conciliación', async () => {
    await harness.service.chat(CTX, {
      message: '¿Qué transacciones siguen sin conciliar entre 2026-02-01 y 2026-02-28?',
    });

    const [toolName, args] = harness.toolCall.mock.calls[0];
    expect(toolName).toBe('list_unreconciled_transactions');
    expect(args).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('usa el mes UTC en curso como periodo por defecto del flujo de caja', async () => {
    const now = new Date();
    const expectedFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}-01`;
    const expectedTo = now.toISOString().slice(0, 10);

    const response = await harness.service.chat(CTX, { message: '¿Cuál es el saldo del mes?' });

    const [toolName, args] = harness.toolCall.mock.calls[0];
    expect(toolName).toBe('get_cashflow_summary');
    expect(args).toMatchObject({ from: expectedFrom, to: expectedTo });
    expect(response.answer).toContain(`${expectedFrom}/${expectedTo}`);
  });

  it('usa la fecha explícita única como periodo de la herramienta', async () => {
    const response = await harness.service.chat(CTX, {
      message: '¿Cuál es el flujo de caja del 2026-03-15?',
    });

    const [toolName, args] = harness.toolCall.mock.calls[0];
    expect(toolName).toBe('get_cashflow_summary');
    expect(args).toMatchObject({ from: '2026-03-15', to: '2026-03-15' });
    expect(response.answer).toContain('2026-03-15');
  });

  it('ordena las fechas explícitas aunque el usuario las escriba invertidas', async () => {
    await harness.service.chat(CTX, {
      message: '¿Flujo de caja entre 2026-03-31 y 2026-03-01?',
    });

    const [, args] = harness.toolCall.mock.calls[0];
    expect(args).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
  });

  it('degrada con ALL_TOOLS_FAILED cuando ninguna herramienta está disponible', async () => {
    harness = createHarness({ toolFails: true });
    const completeSpy = vi.spyOn(harness.provider, 'complete');

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(true);
    expect(response.code).toBe('ALL_TOOLS_FAILED');
    expect(response.reason).toBe(AgentDegradationReason.PROVIDER_ERROR);
    expect(response.answer).toContain('No puedo confirmar cifras');
    expect(response.citations.some((citation) => citation.source === 'tool')).toBe(false);

    // No se consumen tokens del proveedor y se libera la reserva.
    expect(completeSpy).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.settle).not.toHaveBeenCalled();
  });

  it('conserva las citas de memoria cuando todas las herramientas fallan', async () => {
    harness = createHarness({ toolFails: true });
    harness.memories.set(TENANT_ID, [{ id: 'mem-prev', content: 'Contexto previo del tenant.' }]);

    const response = await harness.service.chat(CTX, { message: CASHFLOW_QUESTION });

    expect(response.degraded).toBe(true);
    expect(response.code).toBe('ALL_TOOLS_FAILED');
    expect(response.citations.some((citation) => citation.ref === 'mem-prev')).toBe(true);
    expect(response.answer).toContain('No puedo confirmar cifras');
  });
});

describe('isGroundedAnswer — grounding estricto de cifras', () => {
  it('acepta una respuesta sin cifras', () => {
    expect(isGroundedAnswer('No puedo confirmar cifras', 'saldo 100')).toBe(true);
  });

  it('rechaza una cifra que no aparece en los hechos', () => {
    expect(isGroundedAnswer('El saldo es 999', 'saldo 100')).toBe(false);
  });

  it('acepta cifras en formato europeo cuando coinciden respuesta y hechos', () => {
    expect(isGroundedAnswer('El saldo es 1.234,56', 'saldo 1.234,56')).toBe(true);
  });
});

describe('ChatModule — cableado estático sin dependencias externas', () => {
  it('importa McpModule, BudgetModule, SemanticCacheModule y AgentMemoryModule', () => {
    const imports = Reflect.getMetadata('imports', ChatModule) as unknown[];

    expect(imports).toContain(McpModule);
    expect(imports).toContain(BudgetModule);
    expect(imports).toContain(SemanticCacheModule);
    expect(imports).toContain(AgentMemoryModule);
  });

  it('registra el proveedor determinista bajo el token LLM_PROVIDER', () => {
    const providers = Reflect.getMetadata('providers', ChatModule) as Array<{
      provide?: unknown;
    }>;

    const llmProvider = providers.find((provider) => provider.provide === LLM_PROVIDER);
    expect(llmProvider).toBeDefined();
    expect(typeof llmProvider?.provide).toBe('string');
  });

  it('expone AgentService desde AgentMemoryModule para evitar ciclos', () => {
    const exports = Reflect.getMetadata('exports', AgentMemoryModule) as unknown[];

    expect(exports).toContain(AgentService);
  });

  it('AgentServiceModule importa ChatModule y no duplica ChatService', () => {
    const imports = Reflect.getMetadata('imports', AgentServiceModule) as unknown[];
    const providers = Reflect.getMetadata('providers', AgentServiceModule) as unknown[];

    expect(imports).toContain(ChatModule);
    expect(imports).toContain(AgentMemoryModule);
    expect(providers).not.toContain(ChatService);
  });

  it('la fábrica del token LLM_PROVIDER crea el proveedor determinista', () => {
    const config = {
      get: (key: string, fallback?: unknown) =>
        key === 'LLM_PROVIDER' ? 'deterministic' : fallback,
    } as unknown as ConfigService;

    const provider = createLlmProvider(config);

    expect(provider).toBeInstanceOf(DeterministicLlmProvider);
  });

  it('la fábrica del token LLM_PROVIDER usa el proveedor determinista por defecto', () => {
    const config = {
      get: (_key: string, fallback?: unknown) => fallback,
    } as unknown as ConfigService;

    expect(createLlmProvider(config)).toBeInstanceOf(DeterministicLlmProvider);
  });

  it('la fábrica del token LLM_PROVIDER falla con un proveedor no soportado', () => {
    const config = {
      get: (key: string, fallback?: unknown) => (key === 'LLM_PROVIDER' ? 'openai' : fallback),
    } as unknown as ConfigService;

    expect(() => createLlmProvider(config)).toThrow(/Proveedor de LLM no soportado: openai/);
  });

  it('el provider registrado usa la misma fábrica exportada', () => {
    const providers = Reflect.getMetadata('providers', ChatModule) as Array<{
      provide?: unknown;
      useFactory?: unknown;
    }>;

    const llmProvider = providers.find((provider) => provider.provide === LLM_PROVIDER);
    expect(llmProvider?.useFactory).toBe(createLlmProvider);
  });
});

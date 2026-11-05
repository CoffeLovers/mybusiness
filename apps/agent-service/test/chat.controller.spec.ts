import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  AgentPatterns,
  type AgentChatDto,
  type AgentChatResponseDto,
  type AgentChatRpcPayload,
  type RequestContext,
  UserRole,
} from '@mybusiness/contracts';
import { ChatController } from '../src/chat/chat.controller';
import { ChatService } from '../src/chat/chat.service';

/** Clave de metadatos que Nest usa para registrar el patrón de mensaje. */
const PATTERN_METADATA = 'microservices:pattern';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE: UserRole = UserRole.ACCOUNTANT;

const RESPONSE: AgentChatResponseDto = {
  answer: 'respuesta del asistente',
  citations: [],
  degraded: false,
  usage: {
    promptTokens: 10,
    completionTokens: 5,
    costMicroUsd: 1,
    budgetRemainingMicroUsd: 900,
    cacheHit: false,
  },
};

type ChatFn = (ctx: RequestContext, dto: AgentChatDto) => Promise<AgentChatResponseDto>;

function createController(): { controller: ChatController; chat: Mock<ChatFn> } {
  const chat = vi.fn<ChatFn>(async () => RESPONSE);
  const service = { chat } as unknown as ChatService;
  return { controller: new ChatController(service), chat };
}

describe('ChatController — handler RPC agent.chat', () => {
  it('declara el patrón de mensaje agent.chat', () => {
    const patterns = Reflect.getMetadata(PATTERN_METADATA, ChatController.prototype.chat) as
      string[] | string;

    expect(patterns).toContain(AgentPatterns.CHAT);
  });

  it('extrae el contexto RPC y sanea el payload antes de invocar al servicio', async () => {
    const { controller, chat } = createController();

    const payload: AgentChatRpcPayload = {
      message: '¿Cuál es el flujo de caja?',
      conversationId: 'conv-1',
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: ROLE,
    };

    const result = await controller.chat(payload);

    expect(result).toBe(RESPONSE);
    expect(chat).toHaveBeenCalledTimes(1);

    const [ctx, dto] = chat.mock.calls[0];
    expect(ctx).toEqual({ tenantId: TENANT_ID, userId: USER_ID, role: ROLE });
    expect(dto).toEqual({ message: '¿Cuál es el flujo de caja?', conversationId: 'conv-1' });
    expect(dto).not.toHaveProperty('tenantId');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('role');
  });

  it('sanea el payload aunque el cliente intente inyectar su propia identidad', async () => {
    const { controller, chat } = createController();

    const payload = {
      message: '¿Cuál es el flujo de caja?',
      tenantId: '99999999-9999-4999-8999-999999999999',
      userId: '33333333-3333-4333-8333-333333333333',
      role: 'OWNER',
    } as unknown as AgentChatRpcPayload;

    await controller.chat(payload);

    const [ctx, dto] = chat.mock.calls[0];
    expect(ctx.tenantId).toBe('99999999-9999-4999-8999-999999999999');
    expect(ctx.userId).toBe('33333333-3333-4333-8333-333333333333');
    expect(ctx.role).toBe('OWNER');
    expect(dto).not.toHaveProperty('tenantId');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('role');
  });

  it('propaga al cliente los errores del servicio', async () => {
    const { controller, chat } = createController();
    chat.mockRejectedValue(new Error('boom'));

    await expect(
      controller.chat({
        message: '¿Cuál es el flujo de caja?',
        tenantId: TENANT_ID,
        userId: USER_ID,
        role: ROLE,
      }),
    ).rejects.toThrow('boom');
  });

  it('entrega un contexto vacío cuando el payload no trae identidad', async () => {
    const { controller, chat } = createController();

    await controller.chat({ message: 'hola' } as unknown as AgentChatRpcPayload);

    const [ctx] = chat.mock.calls[0];
    expect(ctx.tenantId).toBe('');
    expect(ctx.userId).toBe('');
  });
});

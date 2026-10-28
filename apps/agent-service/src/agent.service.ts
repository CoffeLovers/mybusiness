import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  QueryAgentMemoryDto,
  RequestContext,
  StoreAgentMemoryDto,
} from '@mybusiness/contracts';

interface MemoryView {
  id: string;
  tenantId: string;
  userId: string;
  content: string;
  contextType: string;
  metadata?: Record<string, unknown>;
  storedAt: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  /** Memorias aisladas por tenant. En producción la consulta usa `eq(agentMemories.tenantId, tenantId)`. */
  private readonly memoriesByTenant = new Map<string, MemoryView[]>();

  async storeMemory(ctx: RequestContext, dto: StoreAgentMemoryDto) {
    const tenantId = this.requireTenant(ctx);
    const memory: MemoryView = {
      id: 'mem-' + Math.random().toString(36).substring(2, 9),
      tenantId,
      // El contexto del token siempre prevalece sobre cualquier campo del DTO.
      userId: ctx.userId,
      content: dto.content,
      contextType: dto.contextType,
      metadata: dto.metadata,
      storedAt: new Date().toISOString(),
    };

    this.tenantMemories(tenantId).push(memory);
    this.logger.log(`Memoria almacenada para tenant: ${tenantId}`);

    return {
      ...memory,
      embeddingDimensions: 1536,
    };
  }

  async queryMemory(ctx: RequestContext, dto: QueryAgentMemoryDto) {
    const tenantId = this.requireTenant(ctx);
    const topK = typeof dto.topK === 'number' && dto.topK > 0 ? dto.topK : undefined;
    const memories = this.tenantMemories(tenantId);

    this.logger.log(`Búsqueda semántica de memoria para tenant: ${tenantId}`);

    return {
      query: dto.queryText,
      results: (topK ? memories.slice(0, topK) : memories).map((memory) => ({
        id: memory.id,
        content: memory.content,
        similarityScore: 0.92,
      })),
    };
  }

  private requireTenant(ctx: RequestContext): string {
    if (!ctx?.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }
    return ctx.tenantId;
  }

  private tenantMemories(tenantId: string): MemoryView[] {
    let memories = this.memoriesByTenant.get(tenantId);
    if (!memories) {
      memories = [
        {
          id: 'mem-1',
          tenantId,
          userId: '',
          content: 'El cliente prefiere reportes mensuales consolidados en formato PDF.',
          contextType: 'USER_PREFERENCE',
          storedAt: new Date().toISOString(),
        },
      ];
      this.memoriesByTenant.set(tenantId, memories);
    }
    return memories;
  }
}

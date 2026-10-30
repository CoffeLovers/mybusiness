import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ContextType,
  type DeleteAgentMemoryDto,
  type QueryAgentMemoryDto,
  type RequestContext,
  type SearchAgentMemoryDto,
  type SearchAgentMemoryResponse,
  type StoreAgentMemoryDto,
  type StoreAgentMemoryResponse,
} from '@mybusiness/contracts';
import { EMBEDDING_SERVICE, type IEmbeddingService } from './embeddings';
import { AgentRepository } from './agent.repository';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly repository: AgentRepository,
    @Inject(EMBEDDING_SERVICE) private readonly embeddingService: IEmbeddingService,
  ) {}

  /**
   * Almacena una nueva memoria semántica generando su embedding vectorial de 1536d.
   * El tenantId proviene del contexto seguro (o DTO validado) garantizando aislamiento multi-tenant.
   */
  async storeMemory(
    ctx: RequestContext,
    dto: StoreAgentMemoryDto,
  ): Promise<StoreAgentMemoryResponse> {
    const tenantId = this.requireTenant(ctx, dto);
    // El contexto autenticado del token siempre prevalece sobre cualquier intento de spoofing
    const userId = ctx?.userId || dto.userId || null;

    if (!dto.content || !dto.content.trim()) {
      throw new BadRequestException('El contenido de la memoria no puede estar vacío.');
    }

    const contextType = dto.contextType || ContextType.CONVERSATION_SUMMARY;

    // Generar embedding (o reutilizar vector de 1536d provisto)
    let embedding: number[];
    if (Array.isArray(dto.embedding) && dto.embedding.length === 1536) {
      embedding = dto.embedding;
    } else {
      embedding = await this.embeddingService.generate(dto.content);
    }

    const record = await this.repository.insert({
      tenantId,
      userId,
      content: dto.content,
      embedding,
      contextType,
      metadata: dto.metadata || {},
    });

    // DoD Issue #14: Nunca registrar embeddings ni contenido sensible completo en logs
    this.logger.log(
      `Memoria persistida id=${record.id} para tenant=${tenantId}, contextType=${contextType}`,
    );

    return {
      id: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      content: record.content,
      contextType: record.contextType,
      metadata: record.metadata,
      createdAt: record.createdAt,
      embeddingDimensions: 1536,
    };
  }

  /**
   * Búsqueda semántica por similitud coseno (<=>) en pgvector.
   * Filtra estrictamente por tenantId para impedir acceso cross-tenant.
   */
  async queryMemory(
    ctx: RequestContext,
    dto: QueryAgentMemoryDto | SearchAgentMemoryDto,
  ): Promise<SearchAgentMemoryResponse> {
    const tenantId = this.requireTenant(ctx, dto);
    const queryText = dto.query || dto.queryText;

    if (!queryText || !queryText.trim()) {
      throw new BadRequestException('El texto de consulta (query / queryText) es requerido.');
    }

    const topK = typeof dto.topK === 'number' && dto.topK > 0 ? Math.min(dto.topK, 50) : 5;
    const threshold = typeof dto.threshold === 'number' ? dto.threshold : undefined;

    // Generar embedding vectorial para la búsqueda
    let queryEmbedding: number[];
    if (Array.isArray(dto.queryEmbedding) && dto.queryEmbedding.length === 1536) {
      queryEmbedding = dto.queryEmbedding;
    } else {
      queryEmbedding = await this.embeddingService.generate(queryText);
    }

    const records = await this.repository.searchSimilar({
      tenantId,
      userId: dto.userId,
      embedding: queryEmbedding,
      topK,
      threshold,
      contextType: dto.contextType,
    });

    // DoD Issue #14: Nunca registrar embeddings ni contenido sensible completo en logs
    this.logger.log(
      `Búsqueda vectorial completada para tenant=${tenantId}, topK=${topK}, coincidencias=${records.length}`,
    );

    return {
      query: queryText,
      results: records.map((r) => ({
        id: r.id,
        content: r.content,
        contextType: r.contextType,
        similarityScore: r.similarityScore,
        distance: r.distance,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Alias de búsqueda por similitud semántica.
   */
  async searchSimilar(
    ctx: RequestContext,
    dto: SearchAgentMemoryDto,
  ): Promise<SearchAgentMemoryResponse> {
    return this.queryMemory(ctx, dto);
  }

  /**
   * Elimina una memoria respetando el tenantId.
   */
  async deleteMemory(
    ctx: RequestContext,
    dto: DeleteAgentMemoryDto | { id: string },
  ): Promise<{ success: boolean; id: string }> {
    const tenantId = this.requireTenant(ctx, dto as any);
    const id = dto.id;

    if (!id) {
      throw new BadRequestException('id es requerido para eliminar memoria.');
    }

    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundException('Memoria no encontrada o no pertenece al tenant.');
    }

    this.logger.log(`Memoria eliminada id=${id} para tenant=${tenantId}`);
    return { success: true, id };
  }

  private requireTenant(ctx: RequestContext, dto?: { tenantId?: string }): string {
    const tenantId = ctx?.tenantId || dto?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }
    return tenantId;
  }
}

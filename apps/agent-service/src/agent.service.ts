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
   * El tenantId y el userId provienen exclusivamente del contexto seguro.
   */
  async storeMemory(
    ctx: RequestContext,
    dto: StoreAgentMemoryDto,
  ): Promise<StoreAgentMemoryResponse> {
    const tenantId = this.requireTenant(ctx);
    const userId = ctx.userId ?? null;

    if (!dto.content || !dto.content.trim()) {
      throw new BadRequestException('El contenido de la memoria no puede estar vacío.');
    }

    const contextType = dto.contextType || ContextType.CONVERSATION_SUMMARY;
    const embedding = await this.embeddingService.generate(dto.content);

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
    const tenantId = this.requireTenant(ctx);
    const queryText = dto.query ?? dto.queryText;

    if (!queryText || !queryText.trim()) {
      throw new BadRequestException('El texto de consulta (query / queryText) es requerido.');
    }

    const topK = dto.topK ?? 5;
    if (!Number.isInteger(topK) || topK < 1 || topK > 50) {
      throw new BadRequestException('topK debe ser un entero entre 1 y 50.');
    }

    if (
      dto.threshold !== undefined &&
      (!Number.isFinite(dto.threshold) || dto.threshold < 0 || dto.threshold > 1)
    ) {
      throw new BadRequestException('threshold debe ser un número entre 0 y 1.');
    }

    const queryEmbedding = await this.embeddingService.generate(queryText);

    const records = await this.repository.searchSimilar({
      tenantId,
      embedding: queryEmbedding,
      topK,
      threshold: dto.threshold,
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
    const tenantId = this.requireTenant(ctx);
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

  private requireTenant(ctx: RequestContext): string {
    const tenantId = ctx?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }
    return tenantId;
  }
}

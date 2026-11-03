import { Injectable } from '@nestjs/common';
import { and, asc, cosineDistance, eq, gt, lte, sql } from 'drizzle-orm';
import { AgentDatabaseService } from '../database/database.service';
import { agentSemanticCache, type AgentSemanticCache } from '../database/schema';
import type {
  CacheSimilarResult,
  ISemanticCacheRepository,
  SaveCacheEntryParams,
} from './semantic-cache.repository.interface';

@Injectable()
export class SemanticCacheRepository implements ISemanticCacheRepository {
  constructor(private readonly database: AgentDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async findExact(tenantId: string, promptHash: string): Promise<AgentSemanticCache | null> {
    const [found] = await this.db
      .select()
      .from(agentSemanticCache)
      .where(
        and(
          eq(agentSemanticCache.tenantId, tenantId),
          eq(agentSemanticCache.promptHash, promptHash),
          gt(agentSemanticCache.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return found ?? null;
  }

  async findSimilar(
    tenantId: string,
    embedding: number[],
    threshold: number,
  ): Promise<CacheSimilarResult | null> {
    const distance = cosineDistance(agentSemanticCache.promptEmbedding, embedding);
    const similarity = sql<number>`1 - (${distance})`;

    const [row] = await this.db
      .select({
        id: agentSemanticCache.id,
        tenantId: agentSemanticCache.tenantId,
        promptHash: agentSemanticCache.promptHash,
        prompt: agentSemanticCache.prompt,
        response: agentSemanticCache.response,
        promptEmbedding: agentSemanticCache.promptEmbedding,
        similarityThreshold: agentSemanticCache.similarityThreshold,
        expiresAt: agentSemanticCache.expiresAt,
        createdAt: agentSemanticCache.createdAt,
        distance,
        similarityScore: similarity,
      })
      .from(agentSemanticCache)
      .where(
        and(
          eq(agentSemanticCache.tenantId, tenantId),
          gt(agentSemanticCache.expiresAt, new Date()),
          sql`1 - (${distance}) >= ${threshold}`,
        ),
      )
      .orderBy(asc(distance))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      entry: {
        id: row.id,
        tenantId: row.tenantId,
        promptHash: row.promptHash,
        prompt: row.prompt,
        response: row.response,
        promptEmbedding: row.promptEmbedding,
        similarityThreshold: row.similarityThreshold,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
      similarityScore: Number(row.similarityScore),
      distance: Number(row.distance),
    };
  }

  async save(params: SaveCacheEntryParams): Promise<AgentSemanticCache> {
    const [saved] = await this.db
      .insert(agentSemanticCache)
      .values({
        tenantId: params.tenantId,
        promptHash: params.promptHash,
        prompt: params.prompt,
        response: params.response,
        promptEmbedding: params.promptEmbedding,
        similarityThreshold: params.similarityThreshold,
        expiresAt: params.expiresAt,
      })
      .onConflictDoUpdate({
        target: [agentSemanticCache.tenantId, agentSemanticCache.promptHash],
        set: {
          response: params.response,
          promptEmbedding: params.promptEmbedding,
          similarityThreshold: params.similarityThreshold,
          expiresAt: params.expiresAt,
          createdAt: sql`NOW()`,
        },
      })
      .returning();

    return saved;
  }

  async invalidateByTenant(tenantId: string): Promise<number> {
    const deleted = await this.db
      .delete(agentSemanticCache)
      .where(eq(agentSemanticCache.tenantId, tenantId))
      .returning({ id: agentSemanticCache.id });

    return deleted.length;
  }

  async purgeExpired(): Promise<number> {
    const deleted = await this.db
      .delete(agentSemanticCache)
      .where(lte(agentSemanticCache.expiresAt, new Date()))
      .returning({ id: agentSemanticCache.id });

    return deleted.length;
  }
}

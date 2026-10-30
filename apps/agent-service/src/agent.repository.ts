import { Injectable } from '@nestjs/common';
import { and, asc, cosineDistance, eq, sql } from 'drizzle-orm';
import { AgentDatabaseService } from './database/database.service';
import { agentMemories, type AgentMemory, type NewAgentMemory } from './database/schema';
import type {
  IAgentRepository,
  SearchSimilarParams,
  SearchSimilarResult,
} from './agent.repository.interface';

@Injectable()
export class AgentRepository implements IAgentRepository {
  constructor(private readonly database: AgentDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async insert(data: NewAgentMemory): Promise<AgentMemory> {
    const [inserted] = await this.db.insert(agentMemories).values(data).returning();
    return inserted;
  }

  async searchSimilar(params: SearchSimilarParams): Promise<SearchSimilarResult[]> {
    const { tenantId, userId, embedding, topK = 5, threshold, contextType } = params;

    const distance = cosineDistance(agentMemories.embedding, embedding);
    const similarity = sql<number>`1 - (${distance})`;

    const conditions = [eq(agentMemories.tenantId, tenantId)];

    if (userId) {
      conditions.push(eq(agentMemories.userId, userId));
    }
    if (contextType) {
      conditions.push(eq(agentMemories.contextType, contextType));
    }
    if (threshold !== undefined && threshold !== null) {
      conditions.push(sql`1 - (${distance}) >= ${threshold}`);
    }

    const rows = await this.db
      .select({
        id: agentMemories.id,
        tenantId: agentMemories.tenantId,
        userId: agentMemories.userId,
        content: agentMemories.content,
        contextType: agentMemories.contextType,
        metadata: agentMemories.metadata,
        createdAt: agentMemories.createdAt,
        distance,
        similarityScore: similarity,
      })
      .from(agentMemories)
      .where(and(...conditions))
      .orderBy(asc(distance))
      .limit(topK);

    return rows.map((r) => ({
      ...r,
      distance: Number(r.distance),
      similarityScore: Number(r.similarityScore),
    }));
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .delete(agentMemories)
      .where(and(eq(agentMemories.id, id), eq(agentMemories.tenantId, tenantId)))
      .returning({ id: agentMemories.id });
    return result.length > 0;
  }

  async findById(id: string, tenantId: string): Promise<AgentMemory | null> {
    const [found] = await this.db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.id, id), eq(agentMemories.tenantId, tenantId)))
      .limit(1);
    return found ?? null;
  }
}

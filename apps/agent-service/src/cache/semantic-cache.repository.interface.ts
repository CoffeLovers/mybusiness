import type { AgentSemanticCache } from '../database/schema';

export const SEMANTIC_CACHE_REPOSITORY = Symbol('SEMANTIC_CACHE_REPOSITORY');

export interface CacheSimilarResult {
  entry: AgentSemanticCache;
  similarityScore: number;
  distance: number;
}

export interface SaveCacheEntryParams {
  tenantId: string;
  promptHash: string;
  prompt: string;
  response: string;
  promptEmbedding?: number[] | null;
  similarityThreshold: number;
  expiresAt: Date;
}

export interface ISemanticCacheRepository {
  findExact(tenantId: string, promptHash: string): Promise<AgentSemanticCache | null>;

  findSimilar(
    tenantId: string,
    embedding: number[],
    threshold: number,
  ): Promise<CacheSimilarResult | null>;

  save(params: SaveCacheEntryParams): Promise<AgentSemanticCache>;

  invalidateByTenant(tenantId: string): Promise<number>;

  purgeExpired(): Promise<number>;
}

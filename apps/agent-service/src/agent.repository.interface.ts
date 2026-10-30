import type { AgentMemory, NewAgentMemory } from './database/schema';
import type { ContextType } from '@mybusiness/contracts';

export interface SearchSimilarParams {
  tenantId: string;
  userId?: string;
  embedding: number[];
  topK?: number;
  threshold?: number;
  contextType?: ContextType | string;
}

export interface SearchSimilarResult extends AgentMemory {
  similarityScore: number;
  distance: number;
}

export interface IAgentRepository {
  insert(data: NewAgentMemory): Promise<AgentMemory>;
  searchSimilar(params: SearchSimilarParams): Promise<SearchSimilarResult[]>;
  delete(id: string, tenantId: string): Promise<boolean>;
  findById(id: string, tenantId: string): Promise<AgentMemory | null>;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ContextType,
  NotFoundException,
  UserRole,
  type RequestContext,
} from '@mybusiness/contracts';
import { AgentService } from '../src/agent.service';
import type { AgentRepository } from '../src/agent.repository';
import type {
  IAgentRepository,
  SearchSimilarParams,
  SearchSimilarResult,
} from '../src/agent.repository.interface';
import type { AgentMemory, NewAgentMemory } from '../src/database/schema';
import { MockEmbeddingService } from '../src/embeddings/mock-embedding.service';

/** Servicio de embeddings con vector de consulta fijo para pruebas deterministas. */
class FixedEmbeddingService extends MockEmbeddingService {
  constructor(private readonly vector: number[]) {
    super();
  }

  override async generate(): Promise<number[]> {
    return this.vector;
  }
}

/**
 * Implementación fake en memoria de IAgentRepository para pruebas unitarias.
 * Calcula similitud coseno real en memoria para verificar la lógica de ranking.
 */
class FakeAgentRepository implements IAgentRepository {
  readonly memories: AgentMemory[] = [];

  async insert(data: NewAgentMemory): Promise<AgentMemory> {
    const memory: AgentMemory = {
      id: `mem-${Math.random().toString(36).substring(2, 9)}`,
      tenantId: data.tenantId,
      userId: data.userId ?? null,
      content: data.content,
      embedding: data.embedding,
      contextType: data.contextType ?? 'CONVERSATION_SUMMARY',
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(),
    };
    this.memories.push(memory);
    return memory;
  }

  async searchSimilar(params: SearchSimilarParams): Promise<SearchSimilarResult[]> {
    const { tenantId, userId, embedding, topK = 5, threshold, contextType } = params;

    let filtered = this.memories.filter((m) => m.tenantId === tenantId);

    if (userId) {
      filtered = filtered.filter((m) => m.userId === userId);
    }
    if (contextType) {
      filtered = filtered.filter((m) => m.contextType === contextType);
    }

    const withSimilarity = filtered.map((m) => {
      const sim = this.cosineSimilarity(m.embedding, embedding);
      const dist = Math.max(0, 1 - sim);
      return {
        id: m.id,
        tenantId: m.tenantId,
        userId: m.userId,
        content: m.content,
        contextType: m.contextType,
        metadata: m.metadata,
        createdAt: m.createdAt,
        similarityScore: Number(sim.toFixed(4)),
        distance: Number(dist.toFixed(4)),
      };
    });

    const thresholdFiltered =
      threshold !== undefined
        ? withSimilarity.filter((m) => m.similarityScore >= threshold)
        : withSimilarity;

    thresholdFiltered.sort((a, b) => a.distance - b.distance);

    return thresholdFiltered.slice(0, topK);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const idx = this.memories.findIndex((m) => m.id === id && m.tenantId === tenantId);
    if (idx === -1) {
      return false;
    }
    this.memories.splice(idx, 1);
    return true;
  }

  async findById(id: string, tenantId: string): Promise<AgentMemory | null> {
    return this.memories.find((m) => m.id === id && m.tenantId === tenantId) ?? null;
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }
    const mag = Math.sqrt(norm1) * Math.sqrt(norm2);
    return mag > 0 ? dot / mag : 0;
  }
}

const tenantA: RequestContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  userId: 'aaaa1111-aaaa-1111-aaaa-111111111111',
  role: UserRole.ACCOUNTANT,
};

const tenantB: RequestContext = {
  tenantId: '22222222-2222-2222-2222-222222222222',
  userId: 'bbbb2222-bbbb-2222-bbbb-222222222222',
  role: UserRole.ACCOUNTANT,
};

describe('AgentService — Memoria Vectorial y Similitud Coseno (#14)', () => {
  let fakeRepo: FakeAgentRepository;
  let embeddingService: MockEmbeddingService;
  let service: AgentService;

  beforeEach(() => {
    fakeRepo = new FakeAgentRepository();
    embeddingService = new MockEmbeddingService();
    service = new AgentService(fakeRepo as unknown as AgentRepository, embeddingService);
  });

  describe('Aislamiento Multi-Tenant', () => {
    it('un tenant no puede recuperar memorias de otro tenant (Cross-Tenant Isolation)', async () => {
      await service.storeMemory(tenantA, {
        content: 'Reportes de auditoría financiera confidenciales de Empresa A',
        contextType: ContextType.FINANCIAL_RULE,
      });

      await service.storeMemory(tenantB, {
        content: 'Reportes de auditoría financiera de Empresa B',
        contextType: ContextType.FINANCIAL_RULE,
      });

      const resultA = await service.queryMemory(tenantA, {
        queryText: 'auditoría financiera',
      });
      const resultB = await service.queryMemory(tenantB, {
        queryText: 'auditoría financiera',
      });

      expect(resultA.results.every((m) => m.content.includes('Empresa A'))).toBe(true);
      expect(resultA.results.some((m) => m.content.includes('Empresa B'))).toBe(false);

      expect(resultB.results.every((m) => m.content.includes('Empresa B'))).toBe(true);
      expect(resultB.results.some((m) => m.content.includes('Empresa A'))).toBe(false);
    });

    it('falla si falta tenantId en el contexto', async () => {
      await expect(
        service.storeMemory({} as RequestContext, { content: 'Sin tenant' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('usa exclusivamente el userId del contexto autenticado', async () => {
      const stored = await service.storeMemory(tenantA, {
        content: 'Preferencia de facturación',
      });

      expect(stored.tenantId).toBe(tenantA.tenantId);
      expect(stored.userId).toBe(tenantA.userId);
    });
  });

  describe('Búsqueda por Similitud Coseno y Ranking', () => {
    it('una consulta devuelve primero la memoria semánticamente más cercana (vectores controlados)', async () => {
      // Vector de consulta base (eje 0 activo)
      const queryVec = new Array<number>(1536).fill(0);
      queryVec[0] = 1;

      // Memoria 1: muy cercana al query (eje 0 = 0.99)
      const closeVec = new Array<number>(1536).fill(0);
      closeVec[0] = 0.99;
      closeVec[1] = 0.1;

      // Memoria 2: lejana al query (eje 1 = 0.99)
      const distantVec = new Array<number>(1536).fill(0);
      distantVec[0] = 0.05;
      distantVec[1] = 0.99;

      await fakeRepo.insert({
        tenantId: tenantA.tenantId,
        userId: null,
        content: 'Memoria semánticamente idéntica o muy cercana',
        embedding: closeVec,
        contextType: ContextType.CONVERSATION_SUMMARY,
        metadata: {},
      });

      await fakeRepo.insert({
        tenantId: tenantA.tenantId,
        userId: null,
        content: 'Memoria no relacionada con la consulta',
        embedding: distantVec,
        contextType: ContextType.CONVERSATION_SUMMARY,
        metadata: {},
      });

      const fixedService = new AgentService(
        fakeRepo as unknown as AgentRepository,
        new FixedEmbeddingService(queryVec),
      );

      const searchResult = await fixedService.queryMemory(tenantA, {
        queryText: 'búsqueda controlada',
        topK: 2,
      });

      expect(searchResult.results).toHaveLength(2);
      expect(searchResult.results[0].content).toBe('Memoria semánticamente idéntica o muy cercana');
      expect(searchResult.results[0].similarityScore).toBeGreaterThan(
        searchResult.results[1].similarityScore,
      );
    });

    it('respeta el umbral mínimo (threshold) de similitud', async () => {
      const queryVec = new Array<number>(1536).fill(0);
      queryVec[0] = 1;

      const highSimVec = new Array<number>(1536).fill(0);
      highSimVec[0] = 0.95;

      const lowSimVec = new Array<number>(1536).fill(0);
      lowSimVec[1] = 1; // Ortogonal -> similitud 0

      await fakeRepo.insert({
        tenantId: tenantA.tenantId,
        userId: null,
        content: 'Alta similitud',
        embedding: highSimVec,
        contextType: ContextType.CONVERSATION_SUMMARY,
        metadata: {},
      });

      await fakeRepo.insert({
        tenantId: tenantA.tenantId,
        userId: null,
        content: 'Baja similitud',
        embedding: lowSimVec,
        contextType: ContextType.CONVERSATION_SUMMARY,
        metadata: {},
      });

      const fixedService = new AgentService(
        fakeRepo as unknown as AgentRepository,
        new FixedEmbeddingService(queryVec),
      );

      const filteredResult = await fixedService.queryMemory(tenantA, {
        queryText: 'test',
        threshold: 0.8,
      });

      expect(filteredResult.results).toHaveLength(1);
      expect(filteredResult.results[0].content).toBe('Alta similitud');
    });

    it('respeta el límite topK en resultados', async () => {
      for (let i = 0; i < 5; i++) {
        await service.storeMemory(tenantA, {
          content: `Regla fiscal número ${i}`,
          contextType: ContextType.FINANCIAL_RULE,
        });
      }

      const res = await service.queryMemory(tenantA, {
        queryText: 'Regla fiscal',
        topK: 2,
      });

      expect(res.results).toHaveLength(2);
    });

    it('filtra por contextType cuando se especifica', async () => {
      await service.storeMemory(tenantA, {
        content: 'Regla: No exceder retenciones',
        contextType: ContextType.FINANCIAL_RULE,
      });

      await service.storeMemory(tenantA, {
        content: 'Preferencia: Modo oscuro en dashboard',
        contextType: ContextType.USER_PREFERENCE,
      });

      const res = await service.queryMemory(tenantA, {
        queryText: 'preferencia regla',
        contextType: ContextType.USER_PREFERENCE,
      });

      expect(res.results).toHaveLength(1);
      expect(res.results[0].contextType).toBe(ContextType.USER_PREFERENCE);
    });

    it('searchSimilar funciona como alias consistente de queryMemory', async () => {
      await service.storeMemory(tenantA, {
        content: 'Memoria compartida para alias',
      });

      const res = await service.searchSimilar(tenantA, {
        query: 'Memoria compartida',
      });

      expect(res.results).toHaveLength(1);
      expect(res.results[0].content).toBe('Memoria compartida para alias');
    });
  });

  describe('Eliminación de Memorias', () => {
    it('elimina la memoria perteneciente al tenant', async () => {
      const stored = await service.storeMemory(tenantA, {
        content: 'Para borrar',
      });

      const deleted = await service.deleteMemory(tenantA, { id: stored.id });
      expect(deleted.success).toBe(true);

      const check = await fakeRepo.findById(stored.id, tenantA.tenantId);
      expect(check).toBeNull();
    });

    it('falla al intentar eliminar memoria de otro tenant', async () => {
      const stored = await service.storeMemory(tenantA, {
        content: 'De tenant A',
      });

      await expect(service.deleteMemory(tenantB, { id: stored.id })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('DoD de Seguridad: Nunca registrar contenido sensible ni embeddings en logs', () => {
    it('el contenido almacenado y los embeddings no aparecen en logs', async () => {
      const logSpy = vi.spyOn(service['logger'], 'log');

      const sensitiveContent = 'CLAVE_SECRETA_API_EMPRESARIAL_98765';
      await service.storeMemory(tenantA, {
        content: sensitiveContent,
      });

      await service.queryMemory(tenantA, {
        queryText: sensitiveContent,
      });

      for (const call of logSpy.mock.calls) {
        const message = String(call[0]);
        expect(message).not.toContain(sensitiveContent);
        expect(message).not.toContain('0.');
        expect(message).not.toContain('embedding');
      }

      logSpy.mockRestore();
    });
  });
});

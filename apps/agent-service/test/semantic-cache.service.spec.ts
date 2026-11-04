import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SemanticCacheService } from '../src/cache/semantic-cache.service';
import { CACHE_TTL_MAX_SECONDS } from '../src/budget/budget.constants';
import type {
  CacheSimilarResult,
  ISemanticCacheRepository,
  SaveCacheEntryParams,
} from '../src/cache/semantic-cache.repository.interface';
import type { AgentSemanticCache } from '../src/database/schema';
import type { IEmbeddingService } from '../src/embeddings';

/** Calcula la similitud coseno entre dos vectores normalizados. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

class FakeSemanticCacheRepository implements ISemanticCacheRepository {
  entries: Map<string, AgentSemanticCache> = new Map();

  async findExact(tenantId: string, promptHash: string): Promise<AgentSemanticCache | null> {
    const key = `${tenantId}:${promptHash}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= new Date()) return null;
    return { ...entry };
  }

  async findSimilar(
    tenantId: string,
    embedding: number[],
    threshold: number,
  ): Promise<CacheSimilarResult | null> {
    const now = new Date();
    let bestMatch: AgentSemanticCache | null = null;
    let bestScore = -1;

    for (const entry of this.entries.values()) {
      if (entry.tenantId !== tenantId) continue;
      if (entry.expiresAt <= now) continue;
      if (!entry.promptEmbedding) continue;

      const score = cosineSimilarity(embedding, entry.promptEmbedding);
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    if (!bestMatch) return null;

    return {
      entry: { ...bestMatch },
      similarityScore: bestScore,
      distance: 1 - bestScore,
    };
  }

  async save(params: SaveCacheEntryParams): Promise<AgentSemanticCache> {
    const key = `${params.tenantId}:${params.promptHash}`;
    const entry: AgentSemanticCache = {
      id: `cache-${Math.random().toString(36).substring(2, 9)}`,
      tenantId: params.tenantId,
      promptHash: params.promptHash,
      prompt: params.prompt,
      response: params.response,
      promptEmbedding: params.promptEmbedding ?? null,
      similarityThreshold: params.similarityThreshold,
      expiresAt: params.expiresAt,
      createdAt: new Date(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  async invalidateByTenant(tenantId: string): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.tenantId === tenantId) {
        this.entries.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async purgeExpired(): Promise<number> {
    const now = new Date();
    let deleted = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}

describe('SemanticCacheService (SF3-03)', () => {
  let fakeRepo: FakeSemanticCacheRepository;
  let fakeEmbeddingService: IEmbeddingService;
  let service: SemanticCacheService;

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  // Vectores ortogonales de prueba (1536 dimensiones simplificadas)
  const vectorBase = new Array(1536).fill(0);
  vectorBase[0] = 1;

  const vectorSimilar = new Array(1536).fill(0);
  vectorSimilar[0] = 0.98;
  vectorSimilar[1] = 0.02;

  const vectorDissimilar = new Array(1536).fill(0);
  vectorDissimilar[100] = 1;

  beforeEach(() => {
    fakeRepo = new FakeSemanticCacheRepository();

    fakeEmbeddingService = {
      generate: vi.fn(async (text: string) => {
        if (text.includes('balance') || text.includes('saldo')) {
          return text.includes('exacto') ? vectorBase : vectorSimilar;
        }
        return vectorDissimilar;
      }),
    };

    const mockConfig = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        switch (key) {
          case 'AGENT_CACHE_ENABLED':
            return 'true';
          case 'AGENT_CACHE_SIMILARITY_THRESHOLD':
            return 0.95;
          case 'AGENT_CACHE_TTL_SECONDS':
            return 3600;
          default:
            return defaultValue;
        }
      }),
    } as unknown as ConfigService;

    service = new SemanticCacheService(fakeRepo, fakeEmbeddingService, mockConfig);
  });

  describe('Búsqueda exacta (SHA-256 match)', () => {
    it('debe encontrar respuesta por hash exacto con similarity = 1.0 sin invocar embeddings', async () => {
      const prompt = '¿Cuál es mi saldo actual?';
      const expectedResponse = 'Su saldo disponible es $15,000,000 COP.';

      await service.set(tenantA, prompt, expectedResponse);

      // Limpiamos llamadas del mock de embeddings
      vi.clearAllMocks();

      const result = await service.get(tenantA, prompt);

      expect(result.hit).toBe(true);
      expect(result.response).toBe(expectedResponse);
      expect(result.similarity).toBe(1.0);
      expect(result.source).toBe('exact');

      // En match exacto NO debe llamarse a generate de nuevo para consultar
      expect(fakeEmbeddingService.generate).not.toHaveBeenCalled();
    });
  });

  describe('Búsqueda semántica por similitud coseno', () => {
    it('debe devolver hit semántico cuando la similitud supera el umbral (0.95)', async () => {
      // Guardamos la entrada base
      await service.set(tenantA, 'saldo exacto', 'Respuesta base');

      // Consultamos con variación semántica
      const result = await service.get(tenantA, 'balance de cuentas');

      expect(result.hit).toBe(true);
      expect(result.source).toBe('semantic');
      expect(result.response).toBe('Respuesta base');
      expect(result.similarity).toBeGreaterThanOrEqual(0.95);
    });

    it('debe dar miss cuando la similitud está por debajo del umbral', async () => {
      await service.set(tenantA, 'saldo exacto', 'Respuesta base');

      const result = await service.get(tenantA, 'cómo crear una factura');

      expect(result.hit).toBe(false);
      expect(result.response).toBeUndefined();
    });
  });

  describe('Expiración por TTL', () => {
    it('no debe devolver entradas que hayan expirado', async () => {
      // Guardar con TTL de -1 segundo (ya expirada)
      await service.set(tenantA, 'pregunta temporal', 'Respuesta', -1);

      const result = await service.get(tenantA, 'pregunta temporal');

      expect(result.hit).toBe(false);
    });

    it('debe rechazar un TTL superior al máximo permitido', async () => {
      await expect(
        service.set(tenantA, 'pregunta', 'Respuesta', CACHE_TTL_MAX_SECONDS + 1),
      ).rejects.toThrow(/TTL de caché inválido/);

      expect(fakeRepo.entries.size).toBe(0);
    });
  });

  describe('Validación estricta de configuración', () => {
    it('no debe arrancar si AGENT_CACHE_TTL_SECONDS excede el máximo', () => {
      const invalidConfig = {
        get: vi.fn((key: string, defaultValue?: unknown) =>
          key === 'AGENT_CACHE_TTL_SECONDS' ? '86400' : defaultValue,
        ),
      } as unknown as ConfigService;

      expect(() => new SemanticCacheService(fakeRepo, fakeEmbeddingService, invalidConfig)).toThrow(
        /AGENT_CACHE_TTL_SECONDS/,
      );
    });

    it('no debe arrancar si AGENT_CACHE_SIMILARITY_THRESHOLD está fuera de rango', () => {
      const invalidConfig = {
        get: vi.fn((key: string, defaultValue?: unknown) =>
          key === 'AGENT_CACHE_SIMILARITY_THRESHOLD' ? '0.2' : defaultValue,
        ),
      } as unknown as ConfigService;

      expect(() => new SemanticCacheService(fakeRepo, fakeEmbeddingService, invalidConfig)).toThrow(
        /AGENT_CACHE_SIMILARITY_THRESHOLD/,
      );
    });
  });

  describe('Aislamiento por Tenant (Zero cross-tenant leaks)', () => {
    it('el caché de Tenant A jamás debe ser visible para Tenant B', async () => {
      const prompt = 'Reporte confidencial de ventas';
      await service.set(tenantA, prompt, 'Datos secretos de A');

      // Consulta del Tenant B con el mismo prompt exacto
      const resultB = await service.get(tenantB, prompt);

      expect(resultB.hit).toBe(false);
      expect(resultB.response).toBeUndefined();

      // Consulta del Tenant A sigue funcionando
      const resultA = await service.get(tenantA, prompt);
      expect(resultA.hit).toBe(true);
      expect(resultA.response).toBe('Datos secretos de A');
    });
  });

  describe('Invalidación por tenant', () => {
    it('debe purgar únicamente las entradas del tenant especificado', async () => {
      await service.set(tenantA, 'prompt A1', 'Resp A1');
      await service.set(tenantA, 'prompt A2', 'Resp A2');
      await service.set(tenantB, 'prompt B1', 'Resp B1');

      const deleted = await service.invalidate(tenantA);
      expect(deleted).toBe(2);

      const checkA = await service.get(tenantA, 'prompt A1');
      const checkB = await service.get(tenantB, 'prompt B1');

      expect(checkA.hit).toBe(false);
      expect(checkB.hit).toBe(true);
      expect(checkB.response).toBe('Resp B1');
    });
  });

  describe('Interruptor de caché deshabilitado', () => {
    it('si AGENT_CACHE_ENABLED es false, get retorna false y set no almacena', async () => {
      const mockConfigDisabled = {
        get: vi.fn((key: string, defaultValue?: unknown) => {
          if (key === 'AGENT_CACHE_ENABLED') return 'false';
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const disabledService = new SemanticCacheService(
        fakeRepo,
        fakeEmbeddingService,
        mockConfigDisabled,
      );

      await disabledService.set(tenantA, 'prompt 1', 'resp 1');
      const result = await disabledService.get(tenantA, 'prompt 1');

      expect(result.hit).toBe(false);
      expect(fakeRepo.entries.size).toBe(0);
    });
  });
});

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_SERVICE, type IEmbeddingService } from '../embeddings';
import {
  BUDGET_CONSTANTS,
  CACHE_TTL_MAX_SECONDS,
  hashPrompt,
  parseConfigNumber,
} from '../budget/budget.constants';
import {
  SEMANTIC_CACHE_REPOSITORY,
  type ISemanticCacheRepository,
} from './semantic-cache.repository.interface';

export interface CacheLookupResult {
  hit: boolean;
  response?: string;
  similarity?: number;
  source?: 'exact' | 'semantic';
}

/**
 * Caché semántica de respuestas del agente por tenant.
 *
 * Política de frescura: TTL corto por defecto (5 min); nunca cachear respuestas
 * financieras sin snapshot de datos, y jamás por encima de `CACHE_TTL_MAX_SECONDS`.
 */
@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly enabled: boolean;
  private readonly similarityThreshold: number;
  private readonly defaultTtlSeconds: number;

  constructor(
    @Inject(SEMANTIC_CACHE_REPOSITORY)
    private readonly cacheRepository: ISemanticCacheRepository,
    @Inject(EMBEDDING_SERVICE)
    private readonly embeddingService: IEmbeddingService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<string>('AGENT_CACHE_ENABLED', 'true') !== 'false';
    this.similarityThreshold = parseConfigNumber(
      this.config.get<unknown>('AGENT_CACHE_SIMILARITY_THRESHOLD'),
      BUDGET_CONSTANTS.DEFAULT_CACHE_SIMILARITY_THRESHOLD,
      0.5,
      1,
      'AGENT_CACHE_SIMILARITY_THRESHOLD',
    );
    this.defaultTtlSeconds = parseConfigNumber(
      this.config.get<unknown>('AGENT_CACHE_TTL_SECONDS'),
      BUDGET_CONSTANTS.DEFAULT_CACHE_TTL_SECONDS,
      1,
      CACHE_TTL_MAX_SECONDS,
      'AGENT_CACHE_TTL_SECONDS',
    );
  }

  /**
   * Busca en la caché semántica para un tenant dado.
   * 1. Búsqueda exacta primero por SHA-256(prompt).
   * 2. Si no hay match exacto y está habilitada la similitud: búsqueda vectorial con cosine distance (<=>).
   * Garantiza aislamiento estricto por tenant (cero fugas cross-tenant).
   */
  async get(tenantId: string, prompt: string): Promise<CacheLookupResult> {
    if (!this.enabled || !prompt?.trim()) {
      return { hit: false };
    }

    const promptHash = hashPrompt(prompt);

    // Paso 1: Búsqueda exacta por hash SHA-256
    const exactMatch = await this.cacheRepository.findExact(tenantId, promptHash);
    if (exactMatch) {
      this.logger.debug(
        `Cache HIT (exact) para tenant ${tenantId}. Hash: ${promptHash.slice(0, 8)}...`,
      );
      return {
        hit: true,
        response: exactMatch.response,
        similarity: 1.0,
        source: 'exact',
      };
    }

    // Paso 2: Búsqueda semántica vectorial
    try {
      const embedding = await this.embeddingService.generate(prompt);
      const similarMatch = await this.cacheRepository.findSimilar(
        tenantId,
        embedding,
        this.similarityThreshold,
      );

      if (similarMatch && similarMatch.similarityScore >= this.similarityThreshold) {
        this.logger.debug(
          `Cache HIT (semantic) para tenant ${tenantId}. Similitud: ${similarMatch.similarityScore.toFixed(4)}`,
        );
        return {
          hit: true,
          response: similarMatch.entry.response,
          similarity: similarMatch.similarityScore,
          source: 'semantic',
        };
      }
    } catch (error) {
      this.logger.warn(
        `Fallo al generar embedding o buscar similitud para tenant ${tenantId}: ${(error as Error).message}`,
      );
    }

    return { hit: false };
  }

  /**
   * Guarda una respuesta en caché semántica para el tenant con TTL.
   */
  async set(
    tenantId: string,
    prompt: string,
    response: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.enabled || !prompt?.trim() || !response) {
      return;
    }

    const promptHash = hashPrompt(prompt);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;

    if (!Number.isFinite(ttl) || ttl > CACHE_TTL_MAX_SECONDS) {
      throw new Error(
        `TTL de caché inválido: ${ttl}s (máximo permitido ${CACHE_TTL_MAX_SECONDS}s)`,
      );
    }

    const expiresAt = new Date(Date.now() + ttl * 1000);

    let embedding: number[] | null = null;
    try {
      embedding = await this.embeddingService.generate(prompt);
    } catch (err) {
      this.logger.warn(
        `No se pudo generar embedding para caché de tenant ${tenantId}: ${(err as Error).message}`,
      );
    }

    await this.cacheRepository.save({
      tenantId,
      promptHash,
      prompt,
      response,
      promptEmbedding: embedding,
      similarityThreshold: this.similarityThreshold,
      expiresAt,
    });

    this.logger.debug(
      `Entrada guardada en caché para tenant ${tenantId}. TTL: ${ttl}s. Hash: ${promptHash.slice(0, 8)}...`,
    );
  }

  /**
   * Invalida todas las entradas de caché para un tenant (purga manual).
   */
  async invalidate(tenantId: string): Promise<number> {
    const deletedCount = await this.cacheRepository.invalidateByTenant(tenantId);
    this.logger.log(`Invalidadas ${deletedCount} entradas de caché para tenant ${tenantId}`);
    return deletedCount;
  }
}

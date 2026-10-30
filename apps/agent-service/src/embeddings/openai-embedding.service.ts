import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IEmbeddingService } from './embedding.interface';

const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'text-embedding-3-small';
const REQUEST_TIMEOUT_MS = 10_000;

interface EmbeddingApiResponse {
  data?: Array<{ embedding?: unknown }>;
}

/**
 * Proveedor de embeddings compatible con la API de OpenAI.
 * Nunca registra en logs el texto de entrada ni el vector generado.
 */
@Injectable()
export class OpenAiEmbeddingService implements IEmbeddingService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('EMBEDDING_API_KEY');
    this.baseUrl = config.get<string>('EMBEDDING_BASE_URL', DEFAULT_BASE_URL);
    this.model = config.get<string>('EMBEDDING_MODEL', DEFAULT_MODEL);
  }

  async generate(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Embedding provider error: ${response.status}`);
    }

    const payload = (await response.json()) as EmbeddingApiResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error(
        `Embedding provider returned an invalid embedding vector (expected ${EMBEDDING_DIMENSIONS} dimensions).`,
      );
    }

    return embedding as number[];
  }
}

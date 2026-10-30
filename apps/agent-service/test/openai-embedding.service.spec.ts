import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingService } from '../src/embeddings/openai-embedding.service';

const BASE_URL = 'https://embeddings.test/v1';
const API_KEY = 'test-api-key';
const DIMENSIONS = 1536;

function createConfigService(): ConfigService {
  return {
    getOrThrow: (key: string): string => {
      if (key === 'EMBEDDING_API_KEY') {
        return API_KEY;
      }
      throw new Error(`Missing config: ${key}`);
    },
    get: (key: string, defaultValue?: string): string | undefined => {
      if (key === 'EMBEDDING_BASE_URL') {
        return BASE_URL;
      }
      return defaultValue;
    },
  } as unknown as ConfigService;
}

function vectorOf(length: number, value = 0.1): number[] {
  return new Array<number>(length).fill(value);
}

describe('OpenAiEmbeddingService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('genera un embedding de 1536 dimensiones enviando el contrato esperado', async () => {
    const embedding = vectorOf(DIMENSIONS);
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ embedding }] }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OpenAiEmbeddingService(createConfigService());
    const result = await service.generate('texto de prueba');

    expect(result).toHaveLength(DIMENSIONS);
    expect(result).toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/embeddings`);
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toBe('texto de prueba');
    expect(body.dimensions).toBe(DIMENSIONS);
  });

  it('rechaza con el código HTTP cuando el proveedor responde 500 sin filtrar el body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal secret detail' }),
        text: () => Promise.resolve('internal secret detail'),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OpenAiEmbeddingService(createConfigService());

    const error = await service.generate('texto').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('500');
    expect(message).not.toContain('internal secret detail');
  });

  it('rechaza cuando el vector devuelto no tiene 1536 dimensiones', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OpenAiEmbeddingService(createConfigService());

    await expect(service.generate('texto')).rejects.toThrow(/1536/);
  });
});

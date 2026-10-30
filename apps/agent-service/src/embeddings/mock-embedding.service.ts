import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IEmbeddingService } from './embedding.interface';

/**
 * Proveedor mock determinista de embeddings de 1536 dimensiones.
 * Genera vectores normalizados L2 usando el hash del texto como semilla,
 * permitiendo pruebas reproducibles sin llamadas externas ni API keys.
 */
@Injectable()
export class MockEmbeddingService implements IEmbeddingService {
  readonly dimensions = 1536;

  async generate(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text, this.dimensions);
  }

  async generateMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generate(t)));
  }

  private generateDeterministicVector(text: string, dimensions: number): number[] {
    const vector = new Array<number>(dimensions);
    const hash = createHash('sha256').update(text).digest();
    let seed = hash.readUInt32LE(0);

    let sumSq = 0;
    for (let i = 0; i < dimensions; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const val = (seed / 4294967295) * 2 - 1;
      vector[i] = val;
      sumSq += val * val;
    }

    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] = Number((vector[i] / norm).toFixed(6));
      }
    }

    return vector;
  }
}

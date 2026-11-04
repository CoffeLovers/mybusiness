import { describe, it, expect } from 'vitest';
import { MockEmbeddingService } from '../src/embeddings/mock-embedding.service';

describe('MockEmbeddingService', () => {
  const service = new MockEmbeddingService();

  it('genera un vector con exactamente 1536 dimensiones', async () => {
    const vector = await service.generate('Regla fiscal 2026');
    expect(vector).toHaveLength(1536);
    expect(vector.every((val) => typeof val === 'number' && !isNaN(val))).toBe(true);
  });

  it('es determinista: el mismo texto produce exactamente el mismo vector', async () => {
    const text = 'Reportes mensuales consolidados en PDF';
    const vector1 = await service.generate(text);
    const vector2 = await service.generate(text);

    expect(vector1).toEqual(vector2);
  });

  it('textos diferentes producen vectores diferentes', async () => {
    const vector1 = await service.generate('Facturación electrónica');
    const vector2 = await service.generate('Configuración de cuenta bancaria');

    expect(vector1).not.toEqual(vector2);
  });

  it('el vector está normalizado L2 (norma euclidiana aproximada a 1.0)', async () => {
    const vector = await service.generate('Prueba de norma vectorial');
    const normSq = vector.reduce((sum, v) => sum + v * v, 0);
    const norm = Math.sqrt(normSq);

    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('generateMany procesa múltiples textos', async () => {
    const vectors = await service.generateMany(['Texto 1', 'Texto 2']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1536);
    expect(vectors[1]).toHaveLength(1536);
  });
});

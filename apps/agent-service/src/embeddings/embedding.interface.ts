export const EMBEDDING_SERVICE = Symbol('EMBEDDING_SERVICE');

export interface IEmbeddingService {
  /**
   * Genera un vector de embedding de 1536 dimensiones para el texto dado.
   */
  generate(text: string): Promise<number[]>;

  /**
   * Genera múltiples vectores de embedding de 1536 dimensiones.
   */
  generateMany?(texts: string[]): Promise<number[][]>;
}

export type EmbeddingProvider = IEmbeddingService;

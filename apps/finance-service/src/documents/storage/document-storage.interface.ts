export interface StoredDocument {
  key: string;
}

export interface DocumentStorage {
  /** Guarda el binario y devuelve la clave lógica. */
  put(key: string, body: Buffer, contentType: string): Promise<StoredDocument>;
  /** Devuelve el contenido o null si no existe. */
  get(key: string): Promise<Buffer | null>;
  /** URL temporal de descarga (S3) o null si el backend no la soporta. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

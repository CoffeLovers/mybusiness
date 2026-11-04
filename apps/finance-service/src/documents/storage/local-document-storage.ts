import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DocumentStorage, StoredDocument } from './document-storage.interface';

/**
 * Almacenamiento local en disco. Útil para desarrollo y pruebas, y como fallback
 * cuando no hay un bucket S3 configurado.
 */
export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly baseDir: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredDocument> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });

    const existing = await this.readOrNull(target);
    if (existing !== null && existing.equals(body)) {
      return { key };
    }

    await writeFile(target, body);
    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    return this.readOrNull(this.resolveKey(key));
  }

  async getSignedUrl(_key: string, _expiresInSeconds: number): Promise<string | null> {
    return null;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Resuelve la clave dentro de baseDir y rechaza rutas que escapen del directorio
   * (path traversal mediante `..` o rutas absolutas).
   */
  private resolveKey(key: string): string {
    const base = path.resolve(this.baseDir);
    const target = path.resolve(base, key);
    if (!target.startsWith(base + path.sep)) {
      throw new Error('Clave de almacenamiento inválida');
    }
    return target;
  }

  private async readOrNull(target: string): Promise<Buffer | null> {
    try {
      return await readFile(target);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

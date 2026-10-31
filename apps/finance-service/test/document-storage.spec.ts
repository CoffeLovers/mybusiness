import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ConfigReader } from '@mybusiness/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDocumentStorage } from '../src/documents/storage/local-document-storage';
import { S3DocumentStorage } from '../src/documents/storage/s3-document-storage';
import { createDocumentStorage } from '../src/documents/storage/storage.factory';

function fakeConfig(values: Record<string, string>): ConfigReader {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const value = values[key];
      return value === undefined ? defaultValue : (value as unknown as T);
    },
  };
}

describe('LocalDocumentStorage', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'mybusiness-docs-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('guarda y recupera el mismo contenido', async () => {
    const storage = new LocalDocumentStorage(baseDir);
    const body = Buffer.from('contenido de prueba');

    const stored = await storage.put('tenant/factura.pdf', body, 'application/pdf');

    expect(stored).toEqual({ key: 'tenant/factura.pdf' });
    const read = await storage.get('tenant/factura.pdf');
    expect(read?.equals(body)).toBe(true);
  });

  it('es idempotente al escribir dos veces la misma clave', async () => {
    const storage = new LocalDocumentStorage(baseDir);
    const body = Buffer.from('repetido');

    await storage.put('a/b.txt', body, 'text/plain');
    const second = await storage.put('a/b.txt', body, 'text/plain');

    expect(second).toEqual({ key: 'a/b.txt' });
    expect((await storage.get('a/b.txt'))?.equals(body)).toBe(true);
  });

  it('devuelve null si la clave no existe', async () => {
    const storage = new LocalDocumentStorage(baseDir);
    await expect(storage.get('no/existe.txt')).resolves.toBeNull();
  });

  it('elimina el documento y luego devuelve null', async () => {
    const storage = new LocalDocumentStorage(baseDir);
    await storage.put('temporal.txt', Buffer.from('x'), 'text/plain');

    await storage.delete('temporal.txt');
    await storage.delete('temporal.txt');

    await expect(storage.get('temporal.txt')).resolves.toBeNull();
  });

  it('rechaza claves que escapan del directorio base', async () => {
    const storage = new LocalDocumentStorage(baseDir);

    await expect(storage.get('../fuera.txt')).rejects.toThrow('Clave de almacenamiento inválida');
    await expect(storage.put('../fuera.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Clave de almacenamiento inválida',
    );
  });

  it('no genera URLs firmadas', async () => {
    const storage = new LocalDocumentStorage(baseDir);
    await expect(storage.getSignedUrl('a.txt', 60)).resolves.toBeNull();
  });
});

describe('createDocumentStorage', () => {
  it('crea un backend local por defecto', () => {
    const storage = createDocumentStorage(fakeConfig({ DOCUMENT_STORAGE_DRIVER: 'local' }));
    expect(storage).toBeInstanceOf(LocalDocumentStorage);
  });

  it('lanza si el driver s3 no tiene S3_BUCKET', () => {
    expect(() => createDocumentStorage(fakeConfig({ DOCUMENT_STORAGE_DRIVER: 's3' }))).toThrow(
      'S3_BUCKET',
    );
  });

  it('lanza con un driver desconocido', () => {
    expect(() => createDocumentStorage(fakeConfig({ DOCUMENT_STORAGE_DRIVER: 'ftp' }))).toThrow(
      'DOCUMENT_STORAGE_DRIVER inválido: ftp',
    );
  });
});

describe('S3DocumentStorage', () => {
  function fakeS3(): { client: S3Client; send: ReturnType<typeof vi.fn> } {
    const send = vi.fn();
    return { client: { send } as unknown as S3Client, send };
  }

  it('devuelve null cuando el objeto no existe', async () => {
    const { client, send } = fakeS3();
    send.mockRejectedValueOnce({ name: 'NoSuchKey' });
    const storage = new S3DocumentStorage(client, 'mi-bucket');

    await expect(storage.get('inexistente.pdf')).resolves.toBeNull();
  });

  it('propaga el error de send al guardar', async () => {
    const { client, send } = fakeS3();
    send.mockRejectedValueOnce(new Error('fallo de red'));
    const storage = new S3DocumentStorage(client, 'mi-bucket');

    await expect(storage.put('doc.pdf', Buffer.from('x'), 'application/pdf')).rejects.toThrow(
      'fallo de red',
    );
  });
});

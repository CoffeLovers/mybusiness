import { S3Client } from '@aws-sdk/client-s3';
import type { ConfigReader } from '@mybusiness/common';
import type { DocumentStorage } from './document-storage.interface';
import { LocalDocumentStorage } from './local-document-storage';
import { S3DocumentStorage } from './s3-document-storage';

const DEFAULT_LOCAL_DIR = '/tmp/mybusiness-documents';

/**
 * Construye el backend de almacenamiento de documentos según `DOCUMENT_STORAGE_DRIVER`.
 * Falla de forma temprana si la configuración de S3 está incompleta.
 */
export function createDocumentStorage(config: ConfigReader): DocumentStorage {
  const driver = config.get<string>('DOCUMENT_STORAGE_DRIVER', 'local') ?? 'local';

  if (driver === 'local') {
    const dir = config.get<string>('DOCUMENTS_LOCAL_DIR', DEFAULT_LOCAL_DIR) ?? DEFAULT_LOCAL_DIR;
    return new LocalDocumentStorage(dir);
  }

  if (driver === 's3') {
    const bucket = requireValue(config, 'S3_BUCKET');
    return new S3DocumentStorage(createS3Client(config), bucket);
  }

  throw new Error(`DOCUMENT_STORAGE_DRIVER inválido: ${driver}`);
}

function createS3Client(config: ConfigReader): S3Client {
  return new S3Client({
    region: config.get<string>('S3_REGION') ?? 'us-east-1',
    endpoint: config.get<string>('S3_ENDPOINT'),
    forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') !== 'false',
    credentials: {
      accessKeyId: requireValue(config, 'S3_ACCESS_KEY'),
      secretAccessKey: requireValue(config, 'S3_SECRET_KEY'),
    },
  });
}

function requireValue(config: ConfigReader, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`Configuración de almacenamiento incompleta: falta ${key}`);
  }
  return value;
}

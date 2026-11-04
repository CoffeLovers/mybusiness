import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentStorage, StoredDocument } from './document-storage.interface';

interface SdkStream {
  transformToByteArray?: () => Promise<Uint8Array>;
}

/**
 * Almacenamiento en S3 (o cualquier endpoint compatible) con cifrado AES256
 * en reposo y URLs de descarga firmadas.
 */
export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<StoredDocument> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const stream = output.Body as unknown as SdkStream | undefined;
      if (!stream || typeof stream.transformToByteArray !== 'function') {
        return null;
      }
      const bytes = await stream.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.Code === 'NoSuchKey'
  ) {
    return true;
  }
  return candidate.$metadata?.httpStatusCode === 404;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { of, Observable } from 'rxjs';
import {
  AgentPatterns,
  ContextType,
  DocumentStatus,
  UserRole,
  type CreateDocumentDto,
  type DocumentOcrJobData,
  type RequestContext,
} from '@mybusiness/contracts';
import type { ConfigService } from '@nestjs/config';
import { DocumentsService } from '../src/documents/documents.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { Document } from '../src/database/schema';
import type { DocumentStorage } from '../src/documents/storage/document-storage.interface';
import type { OcrExtraction, OcrProvider } from '../src/documents/ocr/ocr-provider.interface';

const ctx: RequestContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: UserRole.ACCOUNTANT,
};

const documentId = '33333333-3333-4333-8333-333333333333';
const otherTenantId = '99999999-9999-4999-8999-999999999999';

const pdfBuffer = Buffer.from('%PDF-1.7 contenido de prueba');
const checksum = createHash('sha256').update(pdfBuffer).digest('hex');

function documentRow(overrides: Partial<Document> = {}): Document {
  return {
    id: documentId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    originalName: 'factura.pdf',
    mimeType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    checksumSha256: checksum,
    storageKey: `${ctx.tenantId}/${checksum}.pdf`,
    status: DocumentStatus.PENDING,
    ocrProvider: null,
    confidence: null,
    providerName: null,
    taxId: null,
    issueDate: null,
    currency: null,
    totalMinor: null,
    lineItems: [],
    failureReason: null,
    processedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

const createDto: CreateDocumentDto & { buffer: Buffer } = {
  originalName: 'factura.pdf',
  mimeType: 'application/pdf',
  sizeBytes: pdfBuffer.length,
  buffer: pdfBuffer,
};

function extraction(overrides: Partial<OcrExtraction> = {}): OcrExtraction {
  return {
    providerName: 'Proveedor S.L.',
    taxId: 'B12345678',
    issueDate: '2026-10-01',
    currency: 'EUR',
    totalMinor: '121000',
    lineItems: [
      {
        description: 'Consultoría',
        quantity: 1,
        unitPriceMinor: '100000',
        taxRateBps: 2100,
        totalMinor: '121000',
      },
    ],
    confidence: 0.97,
    raw: {},
    ...overrides,
  };
}

const jobData: DocumentOcrJobData = {
  documentId,
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  storageKey: `${ctx.tenantId}/${checksum}.pdf`,
  mimeType: 'application/pdf',
};

/** Mock encadenable de Drizzle: los builders devuelven el propio objeto. */
function createQueryBuilder() {
  const db: Record<string, unknown> = {};
  const passthrough = () => vi.fn<(...args: unknown[]) => Record<string, unknown>>(() => db);
  const limit = vi.fn<(value?: number) => Promise<unknown[]>>();
  const returning = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

  const select = passthrough();
  const from = passthrough();
  const where = passthrough();
  const orderBy = passthrough();
  const insert = passthrough();
  const values = passthrough();
  const onConflictDoNothing = passthrough();
  const update = passthrough();
  const set = passthrough();

  Object.assign(db, {
    select,
    from,
    where,
    orderBy,
    limit,
    insert,
    values,
    onConflictDoNothing,
    returning,
    update,
    set,
  });

  return {
    db,
    select,
    from,
    where,
    orderBy,
    limit,
    insert,
    values,
    onConflictDoNothing,
    returning,
    update,
    set,
  };
}

describe('DocumentsService', () => {
  let mock: ReturnType<typeof createQueryBuilder>;
  let storage: {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    getSignedUrl: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let ocr: { name: 'stub'; extract: ReturnType<typeof vi.fn> };
  let agentClient: { send: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };
  let service: DocumentsService;

  beforeEach(() => {
    mock = createQueryBuilder();
    mock.limit.mockResolvedValue([]);
    mock.returning.mockResolvedValue([]);

    storage = {
      put: vi.fn(async (key: string) => ({ key })),
      get: vi.fn(async () => pdfBuffer),
      getSignedUrl: vi.fn(async () => 'https://storage.local/signed'),
      delete: vi.fn(async () => undefined),
    };

    ocr = {
      name: 'stub',
      extract: vi.fn(async () => extraction()),
    };

    agentClient = { send: vi.fn(() => of({ id: 'memory-1' })) };
    queue = { add: vi.fn(async () => ({ id: 'job-1' })) };

    const config = {
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };

    service = new DocumentsService(
      { db: mock.db } as unknown as FinanceDatabaseService,
      storage as unknown as DocumentStorage,
      ocr as unknown as OcrProvider,
      agentClient as unknown as ClientProxy,
      queue as unknown as Queue,
      config as unknown as ConfigService,
    );
  });

  it('create calcula el checksum, guarda con la clave del tenant y encola el OCR una vez', async () => {
    const row = documentRow();
    mock.returning.mockResolvedValueOnce([row]);
    mock.limit.mockResolvedValueOnce([row]);

    const result = await service.create(ctx, createDto);

    expect(storage.put).toHaveBeenCalledWith(
      `${ctx.tenantId}/${checksum}.pdf`,
      pdfBuffer,
      'application/pdf',
    );
    expect(result.checksumSha256).toBe(checksum);
    expect(result.id).toBe(documentId);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({ documentId, tenantId: ctx.tenantId, userId: ctx.userId }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  it('una subida duplicada devuelve la fila existente sin reencolar', async () => {
    const existing = documentRow({ status: DocumentStatus.EXTRACTED });
    mock.returning.mockResolvedValueOnce([]);
    mock.limit.mockResolvedValueOnce([existing]);

    const result = await service.create(ctx, createDto);

    expect(result.id).toBe(existing.id);
    expect(result.status).toBe(DocumentStatus.EXTRACTED);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('processOcr con confianza alta marca EXTRACTED, guarda totalMinor como BigInt e indexa', async () => {
    const row = documentRow({ status: DocumentStatus.PROCESSING });
    mock.limit.mockResolvedValueOnce([row]);

    await service.processOcr(jobData);

    const finalUpdate = mock.set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(finalUpdate.status).toBe(DocumentStatus.EXTRACTED);
    expect(finalUpdate.totalMinor).toBe(121000n);
    expect(finalUpdate.ocrProvider).toBe('stub');
    expect(finalUpdate.confidence).toBe('0.970');
    expect(finalUpdate.failureReason).toBeNull();

    expect(agentClient.send).toHaveBeenCalledTimes(1);
    const [pattern, payload] = agentClient.send.mock.calls[0] as [string, Record<string, unknown>];
    expect(pattern).toBe(AgentPatterns.STORE_MEMORY);
    expect(payload.contextType).toBe(ContextType.DOCUMENT);
    expect(payload.metadata).toEqual({
      documentId,
      tenantId: ctx.tenantId,
      source: 'ocr',
    });
  });

  it('processOcr con confianza baja marca NEEDS_REVIEW', async () => {
    ocr.extract.mockResolvedValueOnce(extraction({ confidence: 0.5 }));
    mock.limit.mockResolvedValueOnce([documentRow({ status: DocumentStatus.PROCESSING })]);

    await service.processOcr(jobData);

    const finalUpdate = mock.set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(finalUpdate.status).toBe(DocumentStatus.NEEDS_REVIEW);
  });

  it('processOcr marca FAILED y relanza cuando el OCR falla', async () => {
    ocr.extract.mockRejectedValueOnce(new Error('proveedor caído'));
    mock.limit.mockResolvedValueOnce([documentRow({ status: DocumentStatus.PROCESSING })]);

    await expect(service.processOcr(jobData)).rejects.toThrow('proveedor caído');

    const finalUpdate = mock.set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(finalUpdate.status).toBe(DocumentStatus.FAILED);
    expect(finalUpdate.failureReason).toBe('proveedor caído');
    expect(agentClient.send).not.toHaveBeenCalled();
  });

  it('get lanza NotFoundException para un documento de otro tenant', async () => {
    mock.limit.mockResolvedValueOnce([]);

    await expect(
      service.get({ ...ctx, tenantId: otherTenantId }, documentId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('search mapea similarityScore y filtra por tenant', async () => {
    agentClient.send.mockReturnValueOnce(
      of({
        query: 'factura',
        results: [
          {
            id: 'memory-1',
            content: 'Proveedor S.L.',
            similarityScore: 0.87,
            metadata: { documentId },
          },
        ],
      }),
    );
    mock.limit.mockResolvedValueOnce([documentRow()]);

    const results = await service.search(ctx, 'factura');

    expect(results).toHaveLength(1);
    expect(results[0].document.id).toBe(documentId);
    expect(results[0].score).toBe(0.87);

    const [, payload] = agentClient.send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.tenantId).toBe(ctx.tenantId);
    expect(payload.contextType).toBe(ContextType.DOCUMENT);
  });

  it('search devuelve una lista vacía si agent-service falla', async () => {
    agentClient.send.mockReturnValueOnce(
      new Observable((subscriber) => {
        subscriber.error(new Error('rpc caído'));
      }),
    );

    await expect(service.search(ctx, 'factura')).resolves.toEqual([]);
  });

  it('getDownloadUrl devuelve la URL firmada del documento del tenant', async () => {
    mock.limit.mockResolvedValueOnce([documentRow()]);

    const result = await service.getDownloadUrl(ctx, documentId);

    expect(storage.getSignedUrl).toHaveBeenCalledWith(`${ctx.tenantId}/${checksum}.pdf`, 300);
    expect(result).toEqual({ url: 'https://storage.local/signed' });
  });
});

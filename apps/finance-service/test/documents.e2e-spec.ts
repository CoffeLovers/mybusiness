import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import type { Queue } from 'bullmq';
import { eq, inArray } from 'drizzle-orm';
import { of } from 'rxjs';
import {
  AgentPatterns,
  DocumentStatus,
  UserRole,
  type CreateDocumentDto,
  type DocumentOcrJobData,
  type RequestContext,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../src/database/database.service';
import { documents } from '../src/database/schema';
import { DocumentsService } from '../src/documents/documents.service';
import { LocalDocumentStorage } from '../src/documents/storage/local-document-storage';
import type { DocumentStorage } from '../src/documents/storage/document-storage.interface';
import type { OcrExtraction, OcrProvider } from '../src/documents/ocr/ocr-provider.interface';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const CONFIDENCE_THRESHOLD = 0.85;

describeIfDb('DocumentsService (integración PostgreSQL)', () => {
  let database: FinanceDatabaseService;
  let storageDir: string;
  let service: DocumentsService;

  const userId = randomUUID();
  const tenantIds: string[] = [];

  let confidence: number | null = 0.5;
  let extract: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  function newTenant(): string {
    const tenantId = randomUUID();
    tenantIds.push(tenantId);
    return tenantId;
  }

  function contextFor(tenantId: string): RequestContext {
    return { tenantId, userId, role: UserRole.ACCOUNTANT };
  }

  function pdf(name = 'factura.pdf'): CreateDocumentDto & { buffer: Buffer } {
    const buffer = Buffer.from(`%PDF-1.4 fixture ${randomUUID()}`);
    return {
      originalName: name,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      buffer,
    };
  }

  function storageKeyFor(tenantId: string, buffer: Buffer): string {
    const checksum = createHash('sha256').update(buffer).digest('hex');
    return `${tenantId}/${checksum}.pdf`;
  }

  function jobFor(
    tenantId: string,
    documentId: string,
    dto: CreateDocumentDto & { buffer: Buffer },
  ): DocumentOcrJobData {
    return {
      documentId,
      tenantId,
      userId,
      storageKey: storageKeyFor(tenantId, dto.buffer),
      mimeType: dto.mimeType,
    };
  }

  function storeMemoryCalls(): unknown[][] {
    return send.mock.calls.filter((call) => call[0] === AgentPatterns.STORE_MEMORY);
  }

  async function documentsOf(tenantId: string) {
    return database.db.select().from(documents).where(eq(documents.tenantId, tenantId));
  }

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'docs-'));
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);

    const config = {
      get: (key: string, defaultValue?: unknown): unknown => {
        if (key === 'OCR_CONFIDENCE_THRESHOLD') {
          return String(CONFIDENCE_THRESHOLD);
        }
        if (key === 'DOCUMENTS_LOCAL_DIR') {
          return storageDir;
        }
        return defaultValue;
      },
    } as unknown as ConfigService;

    extract = vi.fn(async (): Promise<OcrExtraction> => ({
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
      confidence,
      raw: {},
    }));

    send = vi.fn(() => of({ results: [] }));
    add = vi.fn(async () => ({ id: 'job-1' }));

    service = new DocumentsService(
      database,
      new LocalDocumentStorage(storageDir) as unknown as DocumentStorage,
      { name: 'stub', extract } as unknown as OcrProvider,
      { send } as unknown as ClientProxy,
      { add } as unknown as Queue,
      config,
    );
  });

  beforeEach(() => {
    confidence = 0.5;
    send.mockClear();
    add.mockClear();
    extract.mockClear();
  });

  afterAll(async () => {
    if (tenantIds.length > 0) {
      await database.db.delete(documents).where(inArray(documents.tenantId, tenantIds));
    }
    await database.onModuleDestroy();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('con confianza baja deja el documento NEEDS_REVIEW y conserva processedAt', async () => {
    const tenantId = newTenant();
    const ctx = contextFor(tenantId);
    const dto = pdf();

    const created = await service.create(ctx, dto);
    await service.processOcr(jobFor(tenantId, created.id, dto));

    const [row] = await documentsOf(tenantId);

    expect(row.status).toBe(DocumentStatus.NEEDS_REVIEW);
    expect(row.confidence).toBe('0.500');
    expect(row.totalMinor).toBe(121000n);
    expect(row.processedAt).not.toBeNull();
  });

  it('con confianza alta marca EXTRACTED', async () => {
    confidence = 0.97;
    const tenantId = newTenant();
    const ctx = contextFor(tenantId);
    const dto = pdf();

    const created = await service.create(ctx, dto);
    await service.processOcr(jobFor(tenantId, created.id, dto));

    const [row] = await documentsOf(tenantId);

    expect(row.status).toBe(DocumentStatus.EXTRACTED);
    expect(row.confidence).toBe('0.970');
  });

  it('una subida duplicada deja una sola fila y encola el OCR una vez', async () => {
    const tenantId = newTenant();
    const ctx = contextFor(tenantId);
    const dto = pdf();

    const first = await service.create(ctx, dto);
    const second = await service.create(ctx, dto);

    const rows = await documentsOf(tenantId);

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('reintentar el OCR no duplica el documento ni la indexación', async () => {
    const tenantId = newTenant();
    const ctx = contextFor(tenantId);
    const dto = pdf();

    const created = await service.create(ctx, dto);
    const job = jobFor(tenantId, created.id, dto);

    await service.processOcr(job);
    expect(storeMemoryCalls()).toHaveLength(1);

    await service.processOcr(job);
    expect(storeMemoryCalls()).toHaveLength(2);

    const rows = await documentsOf(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
  });

  it('get aísla por tenant y search descarta documentos de otros tenants', async () => {
    const tenantA = newTenant();
    const tenantB = newTenant();
    const ctxA = contextFor(tenantA);

    const dtoA = pdf('factura-a.pdf');
    const dtoB = pdf('factura-b.pdf');

    const docA = await service.create(ctxA, dtoA);
    const docB = await service.create(contextFor(tenantB), dtoB);

    await expect(service.get(contextFor(tenantB), docA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    send.mockReturnValueOnce(
      of({
        query: 'factura',
        results: [
          {
            id: 'memory-a',
            content: 'Proveedor A',
            similarityScore: 0.9,
            metadata: { documentId: docA.id },
          },
          {
            id: 'memory-b',
            content: 'Proveedor B',
            similarityScore: 0.8,
            metadata: { documentId: docB.id },
          },
        ],
      }),
    );

    const results = await service.search(ctxA, 'factura');

    expect(results).toHaveLength(1);
    expect(results[0].document.id).toBe(docA.id);
  });
});

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import {
  AgentPatterns,
  ContextType,
  DocumentStatus,
  type CreateDocumentDto,
  type DocumentOcrJobData,
  type DocumentResponse,
  type DocumentSearchResult,
  type RequestContext,
  type SearchAgentMemoryResponse,
} from '@mybusiness/contracts';
import { QUEUE_NAMES, buildJobId, queueToken, rpcSend } from '@mybusiness/common';
import { FinanceDatabaseService } from '../database/database.service';
import { documents, type Document } from '../database/schema';
import { DOCUMENT_STORAGE, type DocumentStorage } from './storage/document-storage.interface';
import { OCR_PROVIDER, type OcrExtraction, type OcrProvider } from './ocr/ocr-provider.interface';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
const MAX_FAILURE_REASON_LENGTH = 500;

/**
 * Ingesta de documentos, extracción OCR y búsqueda semántica.
 *
 * Reglas de seguridad:
 * - Todas las consultas filtran por `tenantId`.
 * - Nunca se registra el contenido del documento ni tokens.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly database: FinanceDatabaseService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(OCR_PROVIDER) private readonly ocr: OcrProvider,
    @Inject('AGENT_SERVICE') private readonly agentClient: ClientProxy,
    @Inject(queueToken(QUEUE_NAMES.OCR)) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Umbral 0..1 por debajo del cual la extracción requiere revisión humana. */
  private get confidenceThreshold(): number {
    const raw = this.config.get<string | number>(
      'OCR_CONFIDENCE_THRESHOLD',
      DEFAULT_CONFIDENCE_THRESHOLD,
    );
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return DEFAULT_CONFIDENCE_THRESHOLD;
    }

    return parsed;
  }

  /**
   * Registra el documento de forma idempotente por `(tenantId, checksumSha256)`
   * y encola su OCR sólo cuando la fila es nueva.
   */
  async create(
    ctx: RequestContext,
    dto: CreateDocumentDto & { buffer: Buffer },
  ): Promise<DocumentResponse> {
    const checksumSha256 = createHash('sha256').update(dto.buffer).digest('hex');
    const storageKey = `${ctx.tenantId}/${checksumSha256}.${extensionFor(dto.mimeType)}`;

    await this.storage.put(storageKey, dto.buffer, dto.mimeType);

    const inserted = await this.db
      .insert(documents)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksumSha256,
        storageKey,
      })
      .onConflictDoNothing({
        target: [documents.tenantId, documents.checksumSha256],
      })
      .returning();

    const [created] = inserted;

    if (!created) {
      const existing = await this.findByChecksum(ctx.tenantId, checksumSha256);
      if (!existing) {
        throw new ConflictException('No se pudo registrar el documento');
      }
      // Subida duplicada: se devuelve la fila existente sin reencolar el OCR.
      return this.mapDocument(existing);
    }

    await this.enqueueOcr(created.id, ctx.tenantId, ctx.userId);

    return this.mapDocument(created);
  }

  /** Publica el job de OCR con un `jobId` idempotente derivado del checksum. */
  async enqueueOcr(documentId: string, tenantId: string, userId: string): Promise<void> {
    const document = await this.findById(tenantId, documentId);
    if (!document) {
      return;
    }

    const data: DocumentOcrJobData = {
      documentId: document.id,
      tenantId,
      userId,
      storageKey: document.storageKey,
      mimeType: document.mimeType,
    };

    await this.queue.add(QUEUE_NAMES.OCR, data, {
      jobId: buildJobId(QUEUE_NAMES.OCR, document.checksumSha256),
    });
  }

  /**
   * Procesa un job de OCR. Relanza los errores de extracción para que BullMQ
   * reintente; la idempotencia del job evita duplicados.
   */
  async processOcr(data: DocumentOcrJobData): Promise<void> {
    const document = await this.findById(data.tenantId, data.documentId);
    if (!document) {
      return;
    }

    await this.updateDocument(data, {
      status: DocumentStatus.PROCESSING,
    });

    let extraction: OcrExtraction;

    try {
      const buffer = await this.storage.get(document.storageKey);

      if (!buffer) {
        await this.markFailed(data, 'archivo_no_disponible');
        return;
      }

      extraction = await this.ocr.extract({
        buffer,
        mimeType: document.mimeType,
        originalName: document.originalName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markFailed(data, message);
      throw error;
    }

    // La extracción del proveedor ya llega normalizada al contrato interno.
    const normalized: OcrExtraction = extraction;
    const requiresReview = (normalized.confidence ?? 0) < this.confidenceThreshold;
    const processedAt = new Date();

    await this.updateDocument(data, {
      status: requiresReview ? DocumentStatus.NEEDS_REVIEW : DocumentStatus.EXTRACTED,
      ocrProvider: this.ocr.name,
      confidence: normalized.confidence === null ? null : normalized.confidence.toFixed(3),
      providerName: normalized.providerName,
      taxId: normalized.taxId,
      issueDate: normalized.issueDate,
      currency: normalized.currency,
      totalMinor: normalized.totalMinor === null ? null : BigInt(normalized.totalMinor),
      lineItems: normalized.lineItems,
      processedAt,
      failureReason: null,
    });

    if (requiresReview) {
      this.logger.log(`Documento ${document.id} requiere revisión (confianza baja)`);
    }

    await this.indexInAgentService(data, normalized);
  }

  async get(ctx: RequestContext, documentId: string): Promise<DocumentResponse> {
    const document = await this.findById(ctx.tenantId, documentId);
    if (!document) {
      throw new NotFoundException('Documento no encontrado');
    }

    return this.mapDocument(document);
  }

  /**
   * Búsqueda semántica delegada en agent-service. Cualquier fallo del RPC se
   * degrada a una lista vacía para no bloquear la consulta.
   */
  async search(ctx: RequestContext, q: string, limit = 10): Promise<DocumentSearchResult[]> {
    let response: SearchAgentMemoryResponse;

    try {
      response = await firstValueFrom(
        rpcSend<SearchAgentMemoryResponse>(this.agentClient, AgentPatterns.SEARCH_MEMORY, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          role: ctx.role,
          query: q,
          topK: limit,
          contextType: ContextType.DOCUMENT,
        }),
      );
    } catch {
      this.logger.warn('Búsqueda de documentos no disponible: fallo en agent-service');
      return [];
    }

    const scores = new Map<string, number>();

    for (const result of response?.results ?? []) {
      const documentId = result.metadata?.documentId;
      if (typeof documentId !== 'string' || scores.has(documentId)) {
        continue;
      }
      scores.set(documentId, result.similarityScore ?? 0);
    }

    if (scores.size === 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, ctx.tenantId),
          inArray(documents.id, [...scores.keys()]),
          isNull(documents.deletedAt),
        ),
      )
      .limit(Math.max(1, Math.min(limit, 50)));

    return rows.map((row) => ({
      document: this.mapDocument(row),
      score: scores.get(row.id) ?? 0,
    }));
  }

  async getDownloadUrl(
    ctx: RequestContext,
    documentId: string,
    expiresInSeconds = 300,
  ): Promise<{ url: string | null }> {
    const document = await this.findById(ctx.tenantId, documentId);
    if (!document) {
      throw new NotFoundException('Documento no encontrado');
    }

    const url = await this.storage.getSignedUrl(document.storageKey, expiresInSeconds);
    return { url };
  }

  private async updateDocument(
    data: DocumentOcrJobData,
    values: Partial<typeof documents.$inferInsert>,
  ): Promise<void> {
    await this.db
      .update(documents)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(documents.tenantId, data.tenantId), eq(documents.id, data.documentId)));
  }

  private async markFailed(data: DocumentOcrJobData, reason: string): Promise<void> {
    await this.updateDocument(data, {
      status: DocumentStatus.FAILED,
      failureReason: reason.slice(0, MAX_FAILURE_REASON_LENGTH),
    });
  }

  /** Indexa la extracción en agent-service; un fallo no altera el estado del documento. */
  private async indexInAgentService(
    data: DocumentOcrJobData,
    extraction: OcrExtraction,
  ): Promise<void> {
    try {
      await firstValueFrom(
        rpcSend(this.agentClient, AgentPatterns.STORE_MEMORY, {
          tenantId: data.tenantId,
          userId: data.userId,
          content: buildEmbeddingText(extraction),
          contextType: ContextType.DOCUMENT,
          metadata: {
            documentId: data.documentId,
            tenantId: data.tenantId,
            source: 'ocr',
          },
        }),
      );
    } catch {
      this.logger.warn(`No se pudo indexar el documento ${data.documentId} en agent-service`);
    }
  }

  private async findById(tenantId: string, documentId: string): Promise<Document | null> {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    return document ?? null;
  }

  private async findByChecksum(tenantId: string, checksumSha256: string): Promise<Document | null> {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.checksumSha256, checksumSha256),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    return document ?? null;
  }

  private mapDocument(row: Document): DocumentResponse {
    return {
      id: row.id,
      tenantId: row.tenantId,
      status: row.status as DocumentStatus,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksumSha256: row.checksumSha256,
      provider: row.providerName,
      taxId: row.taxId,
      issueDate: row.issueDate,
      currency: row.currency,
      totalMinor: row.totalMinor === null ? null : row.totalMinor.toString(),
      confidence: row.confidence === null ? null : Number(row.confidence),
      requiresReview: row.status === DocumentStatus.NEEDS_REVIEW,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Texto indexable: sólo datos de la factura, nunca información del usuario. */
function buildEmbeddingText(extraction: OcrExtraction): string {
  const parts = [
    extraction.providerName ? `Proveedor: ${extraction.providerName}` : null,
    extraction.taxId ? `NIF: ${extraction.taxId}` : null,
    extraction.issueDate ? `Fecha: ${extraction.issueDate}` : null,
    extraction.currency ? `Moneda: ${extraction.currency}` : null,
    extraction.totalMinor ? `Total (unidades menores): ${extraction.totalMinor}` : null,
  ];

  const descriptions = extraction.lineItems
    .map((item) => item.description.trim())
    .filter((description) => description.length > 0);

  if (descriptions.length > 0) {
    parts.push(`Conceptos: ${descriptions.join(', ')}`);
  }

  return parts.filter((part): part is string => part !== null).join('. ');
}

/** Extensión de almacenamiento derivada del MIME type validado. */
function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

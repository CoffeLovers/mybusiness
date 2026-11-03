import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  ReconciliationEvents,
  ReconciliationMatchStatus,
  ReconciliationRunStatus,
  ReconciliationTrigger,
  type ManualReconciliationDto,
  type ReconciliationEvidence,
  type ReconciliationMetricsResponse,
  type ReconciliationReviewItemResponse,
  type ReconciliationRunResponse,
  type ReconciliationSettingsResponse,
  type RequestContext,
  type UpdateReconciliationSettingsDto,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import { DomainEventPublisher } from '../events/domain-event.publisher';
import {
  bankAccounts,
  bankTransactions,
  documents,
  invoices,
  reconciliationMatches,
  reconciliationRuns,
  reconciliationSettings,
  type ReconciliationMatch,
  type ReconciliationSettings as DbReconciliationSettings,
} from '../database/schema';
import {
  matchBatch,
  scoreCandidatePair,
  toBigIntAbsolute,
  type MatcherBankTransaction,
  type MatcherDocument,
} from './reconciliation.matcher';
import { ReconciliationScheduler } from './reconciliation.scheduler';

const DEFAULT_DATE_WINDOW_DAYS = 5;
const DEFAULT_AUTO_MATCH_THRESHOLD_BPS = 8500;
const DEFAULT_TIMEZONE = 'America/Bogota';
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.85;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly database: FinanceDatabaseService,
    private readonly eventPublisher: DomainEventPublisher,
    private readonly scheduler: ReconciliationScheduler,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private get batchSize(): number {
    const raw = this.config.get<string | number>('RECONCILIATION_BATCH_SIZE', DEFAULT_BATCH_SIZE);
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
  }

  private get ocrConfidenceThreshold(): number {
    const raw = this.config.get<string | number>(
      'OCR_CONFIDENCE_THRESHOLD',
      DEFAULT_OCR_CONFIDENCE_THRESHOLD,
    );
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : DEFAULT_OCR_CONFIDENCE_THRESHOLD;
  }

  /**
   * Obtiene la configuración de conciliación del tenant o crea la predeterminada si no existe.
   */
  async getSettings(ctx: RequestContext): Promise<ReconciliationSettingsResponse> {
    const settings = await this.getOrCreateSettings(ctx.tenantId);
    return this.mapSettingsResponse(settings);
  }

  /**
   * Actualiza la configuración de conciliación y sincroniza el JobScheduler si cambian la zona horaria o el cron.
   */
  async updateSettings(
    ctx: RequestContext,
    dto: UpdateReconciliationSettingsDto,
  ): Promise<ReconciliationSettingsResponse> {
    const current = await this.getOrCreateSettings(ctx.tenantId);

    const dateWindowDays = dto.dateWindowDays ?? current.dateWindowDays;
    const autoMatchThresholdBps = dto.autoMatchThresholdBps ?? current.autoMatchThresholdBps;
    const timezone = dto.timezone ?? current.timezone;
    const lookbackDays = dto.lookbackDays ?? current.lookbackDays;
    const nightlyEnabled = dto.nightlyEnabled ?? current.nightlyEnabled;

    const [updated] = await this.db
      .insert(reconciliationSettings)
      .values({
        tenantId: ctx.tenantId,
        dateWindowDays,
        autoMatchThresholdBps,
        timezone,
        lookbackDays,
        nightlyEnabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [reconciliationSettings.tenantId],
        set: {
          dateWindowDays,
          autoMatchThresholdBps,
          timezone,
          lookbackDays,
          nightlyEnabled,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Actualizar el cron nocturno si cambió la configuración
    const scheduleChanged =
      current.nightlyEnabled !== nightlyEnabled || current.timezone !== timezone;

    if (scheduleChanged) {
      if (nightlyEnabled) {
        await this.scheduler.scheduleNightly(ctx.tenantId, timezone);
      } else {
        await this.scheduler.removeNightly(ctx.tenantId);
      }
    }

    return this.mapSettingsResponse(updated);
  }

  /**
   * Ejecuta la conciliación automática para el tenant.
   * Proceso por lotes idempotente:
   * 1. Crea fila RUNNING en reconciliation_runs.
   * 2. Carga en lote bank_transactions no removidas y no conciliadas.
   * 3. Carga documentos candidatos del tenant.
   * 4. Calcula candidatos en memoria.
   * 5. Persiste AUTO_MATCHED o NEEDS_REVIEW con onConflictDoUpdate.
   * 6. Actualiza la fila de run con contadores y estado.
   * 7. Emite evento de auditoría banking.reconciliation.run.
   */
  async runForTenant(
    tenantId: string,
    trigger: ReconciliationTrigger | 'MANUAL' | 'NIGHTLY' = ReconciliationTrigger.MANUAL,
    from?: string,
    to?: string,
  ): Promise<ReconciliationRunResponse> {
    const settings = await this.getOrCreateSettings(tenantId);

    // 1. Crear fila RUNNING en reconciliation_runs
    const [run] = await this.db
      .insert(reconciliationRuns)
      .values({
        tenantId,
        trigger: trigger as ReconciliationTrigger,
        status: ReconciliationRunStatus.RUNNING,
        startedAt: new Date(),
      })
      .returning();

    try {
      // 2. Determinar ventana de fechas
      const lookbackDays = settings.lookbackDays;
      let fromDateStr = from;
      if (!fromDateStr) {
        const d = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
        fromDateStr = d.toISOString().slice(0, 10);
      }
      const toDateStr = to;

      // Movimientos y documentos ya activamente conciliados para excluirlos
      const activeMatches = await this.db
        .select({
          bankTransactionId: reconciliationMatches.bankTransactionId,
          documentId: reconciliationMatches.documentId,
        })
        .from(reconciliationMatches)
        .where(
          and(
            eq(reconciliationMatches.tenantId, tenantId),
            inArray(reconciliationMatches.status, [
              ReconciliationMatchStatus.AUTO_MATCHED,
              ReconciliationMatchStatus.MANUAL_MATCHED,
            ]),
          ),
        );

      const reconciledTxIds = new Set(activeMatches.map((m) => m.bankTransactionId));
      const reconciledDocIds = new Set(activeMatches.map((m) => m.documentId));

      // 3. Cargar bank_transactions no removidas y no conciliadas del tenant
      const txQuery = this.db
        .select({
          id: bankTransactions.id,
          amountMinor: bankTransactions.amountMinor,
          isoCurrencyCode: bankTransactions.isoCurrencyCode,
          date: bankTransactions.date,
          name: bankTransactions.name,
          merchantName: bankTransactions.merchantName,
        })
        .from(bankTransactions)
        .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
        .where(
          and(
            eq(bankAccounts.tenantId, tenantId),
            isNull(bankAccounts.deletedAt),
            isNull(bankTransactions.removedAt),
            sql`${bankTransactions.date} >= ${fromDateStr}`,
            toDateStr ? sql`${bankTransactions.date} <= ${toDateStr}` : sql`1=1`,
          ),
        )
        .limit(this.batchSize);

      const rawTxs = await txQuery;
      const unreconciledTxs: MatcherBankTransaction[] = rawTxs
        .filter((tx) => !reconciledTxIds.has(tx.id))
        .map((tx) => ({
          id: tx.id,
          amountMinor: tx.amountMinor,
          isoCurrencyCode: tx.isoCurrencyCode,
          date: tx.date,
          name: tx.name,
          merchantName: tx.merchantName,
        }));

      // 4. Cargar documentos candidatos del tenant (no removidos, no conciliados)
      const docQuery = this.db
        .select({
          id: documents.id,
          totalMinor: documents.totalMinor,
          currency: documents.currency,
          issueDate: documents.issueDate,
          createdAt: documents.createdAt,
          providerName: documents.providerName,
          invoiceNumber: documents.invoiceNumber,
          status: documents.status,
          confidence: documents.confidence,
        })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, tenantId),
            isNull(documents.deletedAt),
            sql`${documents.totalMinor} IS NOT NULL`,
            inArray(documents.status, ['EXTRACTED', 'NEEDS_REVIEW']),
          ),
        )
        .limit(this.batchSize * 2);

      const rawDocs = await docQuery;
      const candidateDocs: MatcherDocument[] = rawDocs
        .filter((d) => !reconciledDocIds.has(d.id))
        .map((d) => ({
          id: d.id,
          totalMinor: d.totalMinor,
          currency: d.currency,
          issueDate: d.issueDate,
          createdAt: d.createdAt,
          providerName: d.providerName,
          invoiceNumber: d.invoiceNumber,
          status: d.status,
          confidence: d.confidence === null ? null : Number(d.confidence),
        }));

      // 5. Cargar facturas vinculadas a documentos para enriquecer invoiceId
      const candidateDocIds = candidateDocs.map((d) => d.id);
      const invoiceMap = new Map<string, string>();
      if (candidateDocIds.length > 0) {
        const foundInvoices = await this.db
          .select({
            id: invoices.id,
            documentId: invoices.documentId,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, tenantId),
              isNull(invoices.deletedAt),
              inArray(invoices.documentId, candidateDocIds),
            ),
          );

        for (const inv of foundInvoices) {
          if (inv.documentId) {
            invoiceMap.set(inv.documentId, inv.id);
          }
        }
      }

      // 6. Ejecutar el matching en memoria
      const matchCandidates = matchBatch(unreconciledTxs, candidateDocs, {
        dateWindowDays: settings.dateWindowDays,
        autoMatchThresholdBps: settings.autoMatchThresholdBps,
        ocrConfidenceThreshold: this.ocrConfidenceThreshold,
      });

      // 7. Persistir matches con onConflictDoUpdate
      let autoMatchedCount = 0;
      let needsReviewCount = 0;

      for (const item of matchCandidates) {
        const invoiceId = invoiceMap.get(item.documentId) ?? null;
        const matchedAt = item.isAutoMatch ? new Date() : null;

        await this.db
          .insert(reconciliationMatches)
          .values({
            tenantId,
            bankTransactionId: item.bankTransactionId,
            documentId: item.documentId,
            invoiceId,
            status: item.status,
            score: item.score.toFixed(3),
            rule: item.rule,
            evidence: item.evidence as unknown as Record<string, unknown>,
            matchedAt,
          })
          .onConflictDoUpdate({
            target: [
              reconciliationMatches.tenantId,
              reconciliationMatches.bankTransactionId,
              reconciliationMatches.documentId,
            ],
            set: {
              score: sql`excluded.score`,
              rule: sql`excluded.rule`,
              evidence: sql`excluded.evidence`,
              status: sql`CASE
                WHEN ${reconciliationMatches.status} IN ('MANUAL_MATCHED', 'REJECTED') THEN ${reconciliationMatches.status}
                ELSE excluded.status
              END`,
              matchedAt: sql`CASE
                WHEN ${reconciliationMatches.status} IN ('MANUAL_MATCHED', 'REJECTED') THEN ${reconciliationMatches.matchedAt}
                ELSE excluded.matched_at
              END`,
              updatedAt: new Date(),
            },
          });

        if (item.status === ReconciliationMatchStatus.AUTO_MATCHED) {
          autoMatchedCount++;
        } else {
          needsReviewCount++;
        }
      }

      // 8. Actualizar fila de run
      const processedCount = unreconciledTxs.length;
      const finishedAt = new Date();

      const [completedRun] = await this.db
        .update(reconciliationRuns)
        .set({
          status: ReconciliationRunStatus.COMPLETED,
          finishedAt,
          processed: processedCount,
          autoMatched: autoMatchedCount,
          needsReview: needsReviewCount,
          errors: 0,
        })
        .where(eq(reconciliationRuns.id, run.id))
        .returning();

      // 9. Publicar auditoría
      await this.eventPublisher.publish(ReconciliationEvents.RUN, {
        tenantId,
        trigger,
        counters: {
          processed: processedCount,
          autoMatched: autoMatchedCount,
          needsReview: needsReviewCount,
          errors: 0,
        },
        runId: run.id,
      });

      this.logger.log(
        `Run de conciliación ${run.id} completado para tenant ${tenantId}: processed=${processedCount}, autoMatched=${autoMatchedCount}, needsReview=${needsReviewCount}`,
      );

      return this.mapRunResponse(completedRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error en ejecución de conciliación ${run.id}: ${message}`);

      await this.db
        .update(reconciliationRuns)
        .set({
          status: ReconciliationRunStatus.FAILED,
          finishedAt: new Date(),
          errors: 1,
          errorMessage: message.slice(0, 500),
        })
        .where(eq(reconciliationRuns.id, run.id));

      throw error;
    }
  }

  /**
   * Lista los elementos pendientes de revisión humana (NEEDS_REVIEW).
   */
  async listReview(
    ctx: RequestContext,
    cursor?: string,
    limit = 20,
  ): Promise<{
    items: ReconciliationReviewItemResponse[];
    nextCursor: string | null;
    total: number;
  }> {
    const pageLimit = Math.max(1, Math.min(limit, 100));

    // Contar total
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(reconciliationMatches)
      .where(
        and(
          eq(reconciliationMatches.tenantId, ctx.tenantId),
          eq(reconciliationMatches.status, ReconciliationMatchStatus.NEEDS_REVIEW),
        ),
      );
    const total = Number(countResult?.count ?? 0);

    // Consulta con joins
    const query = this.db
      .select({
        match: reconciliationMatches,
        tx: bankTransactions,
        doc: documents,
        inv: invoices,
      })
      .from(reconciliationMatches)
      .innerJoin(bankTransactions, eq(reconciliationMatches.bankTransactionId, bankTransactions.id))
      .innerJoin(documents, eq(reconciliationMatches.documentId, documents.id))
      .leftJoin(invoices, eq(reconciliationMatches.invoiceId, invoices.id))
      .where(
        and(
          eq(reconciliationMatches.tenantId, ctx.tenantId),
          eq(reconciliationMatches.status, ReconciliationMatchStatus.NEEDS_REVIEW),
          cursor ? sql`${reconciliationMatches.id} > ${cursor}` : sql`1=1`,
        ),
      )
      .orderBy(desc(reconciliationMatches.score), desc(reconciliationMatches.createdAt))
      .limit(pageLimit + 1);

    const rows = await query;
    const hasMore = rows.length > pageLimit;
    const items = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].match.id : null;

    const mapped = items.map((r) => this.mapReviewItemResponse(r.match, r.tx, r.doc, r.inv));

    return {
      items: mapped,
      nextCursor,
      total,
    };
  }

  /**
   * Confirma manualmente un match en revisión (pasa a MANUAL_MATCHED).
   */
  async confirmReview(
    ctx: RequestContext,
    matchId: string,
  ): Promise<ReconciliationReviewItemResponse> {
    const [existing] = await this.db
      .select()
      .from(reconciliationMatches)
      .where(
        and(
          eq(reconciliationMatches.id, matchId),
          eq(reconciliationMatches.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Match de conciliación no encontrado.');
    }

    // Verificar si el movimiento o documento ya tiene otra conciliación activa
    const conflicting = await this.db
      .select({ id: reconciliationMatches.id })
      .from(reconciliationMatches)
      .where(
        and(
          eq(reconciliationMatches.tenantId, ctx.tenantId),
          sql`${reconciliationMatches.id} != ${matchId}`,
          inArray(reconciliationMatches.status, [
            ReconciliationMatchStatus.AUTO_MATCHED,
            ReconciliationMatchStatus.MANUAL_MATCHED,
          ]),
          or(
            eq(reconciliationMatches.bankTransactionId, existing.bankTransactionId),
            eq(reconciliationMatches.documentId, existing.documentId),
          ),
        ),
      )
      .limit(1);

    if (conflicting.length > 0) {
      throw new ConflictException(
        'El movimiento bancario o documento ya tiene otra conciliación activa.',
      );
    }

    const matchedAt = new Date();
    const [updated] = await this.db
      .update(reconciliationMatches)
      .set({
        status: ReconciliationMatchStatus.MANUAL_MATCHED,
        matchedBy: ctx.userId,
        matchedAt,
        rule: 'manual',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reconciliationMatches.id, matchId),
          eq(reconciliationMatches.tenantId, ctx.tenantId),
        ),
      )
      .returning();

    await this.eventPublisher.publish(ReconciliationEvents.MANUAL_MATCH, {
      tenantId: ctx.tenantId,
      matchId: updated.id,
      bankTransactionId: updated.bankTransactionId,
      documentId: updated.documentId,
      matchedBy: ctx.userId,
      matchedAt: matchedAt.toISOString(),
    });

    return this.getReviewItemDetail(ctx.tenantId, updated.id);
  }

  /**
   * Rechaza una sugerencia de match (pasa a REJECTED).
   */
  async rejectReview(
    ctx: RequestContext,
    matchId: string,
  ): Promise<ReconciliationReviewItemResponse> {
    const [existing] = await this.db
      .select()
      .from(reconciliationMatches)
      .where(
        and(
          eq(reconciliationMatches.id, matchId),
          eq(reconciliationMatches.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Match de conciliación no encontrado.');
    }

    const [updated] = await this.db
      .update(reconciliationMatches)
      .set({
        status: ReconciliationMatchStatus.REJECTED,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reconciliationMatches.id, matchId),
          eq(reconciliationMatches.tenantId, ctx.tenantId),
        ),
      )
      .returning();

    await this.eventPublisher.publish(ReconciliationEvents.REJECT, {
      tenantId: ctx.tenantId,
      matchId: updated.id,
      rejectedBy: ctx.userId,
      rejectedAt: new Date().toISOString(),
    });

    return this.getReviewItemDetail(ctx.tenantId, updated.id);
  }

  /**
   * Concilia manualmente un movimiento bancario y un documento.
   * Valida aislamiento de tenant, coincidencia de importe y ausencia de conciliación activa previa.
   */
  async manualMatch(
    ctx: RequestContext,
    dto: ManualReconciliationDto,
  ): Promise<ReconciliationReviewItemResponse> {
    // 1. Obtener movimiento bancario del tenant
    const [txRow] = await this.db
      .select({
        id: bankTransactions.id,
        amountMinor: bankTransactions.amountMinor,
        isoCurrencyCode: bankTransactions.isoCurrencyCode,
        date: bankTransactions.date,
        name: bankTransactions.name,
        merchantName: bankTransactions.merchantName,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
      .where(
        and(
          eq(bankTransactions.id, dto.bankTransactionId),
          eq(bankAccounts.tenantId, ctx.tenantId),
          isNull(bankAccounts.deletedAt),
          isNull(bankTransactions.removedAt),
        ),
      )
      .limit(1);

    if (!txRow) {
      throw new NotFoundException('Movimiento bancario no encontrado para este tenant.');
    }

    // 2. Obtener documento del tenant
    const [docRow] = await this.db
      .select({
        id: documents.id,
        totalMinor: documents.totalMinor,
        currency: documents.currency,
        issueDate: documents.issueDate,
        createdAt: documents.createdAt,
        providerName: documents.providerName,
        invoiceNumber: documents.invoiceNumber,
        status: documents.status,
        confidence: documents.confidence,
        originalName: documents.originalName,
        taxId: documents.taxId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, dto.documentId),
          eq(documents.tenantId, ctx.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!docRow) {
      throw new NotFoundException('Documento no encontrado para este tenant.');
    }

    // 3. Validar coincidencia de importe absoluto
    const txAmount = toBigIntAbsolute(txRow.amountMinor);
    const docAmount = toBigIntAbsolute(docRow.totalMinor);
    if (txAmount !== docAmount) {
      throw new BadRequestException(
        `El importe del movimiento bancario (${txAmount}) no coincide con el total del documento (${docAmount}).`,
      );
    }

    // 4. Validar moneda si ambos la informan
    const txCurrency = txRow.isoCurrencyCode?.trim().toUpperCase();
    const docCurrency = docRow.currency?.trim().toUpperCase();
    if (txCurrency && docCurrency && txCurrency !== docCurrency) {
      throw new BadRequestException(
        `La moneda del movimiento (${txCurrency}) no coincide con la del documento (${docCurrency}).`,
      );
    }

    // 5. Validar que ni la transacción ni el documento tengan conciliación activa previa
    const conflicting = await this.db
      .select({ id: reconciliationMatches.id })
      .from(reconciliationMatches)
      .where(
        and(
          eq(reconciliationMatches.tenantId, ctx.tenantId),
          inArray(reconciliationMatches.status, [
            ReconciliationMatchStatus.AUTO_MATCHED,
            ReconciliationMatchStatus.MANUAL_MATCHED,
          ]),
          or(
            eq(reconciliationMatches.bankTransactionId, dto.bankTransactionId),
            eq(reconciliationMatches.documentId, dto.documentId),
          ),
        ),
      )
      .limit(1);

    if (conflicting.length > 0) {
      throw new ConflictException(
        'El movimiento bancario o documento ya cuenta con una conciliación activa.',
      );
    }

    // 6. Obtener factura asociada si existe
    const [invRow] = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.documentId, dto.documentId),
          eq(invoices.tenantId, ctx.tenantId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1);

    const invoiceId = invRow?.id ?? null;
    const settings = await this.getOrCreateSettings(ctx.tenantId);

    // Calcular evidencia de auditoría
    const { score, evidence } = scoreCandidatePair(
      txRow,
      {
        id: docRow.id,
        totalMinor: docRow.totalMinor,
        currency: docRow.currency,
        issueDate: docRow.issueDate,
        createdAt: docRow.createdAt,
        providerName: docRow.providerName,
        invoiceNumber: docRow.invoiceNumber,
        status: docRow.status,
      },
      settings.dateWindowDays,
    );

    const matchedAt = new Date();
    const [created] = await this.db
      .insert(reconciliationMatches)
      .values({
        tenantId: ctx.tenantId,
        bankTransactionId: dto.bankTransactionId,
        documentId: dto.documentId,
        invoiceId,
        status: ReconciliationMatchStatus.MANUAL_MATCHED,
        score: score.toFixed(3),
        rule: 'manual',
        evidence: evidence as unknown as Record<string, unknown>,
        matchedBy: ctx.userId,
        matchedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          reconciliationMatches.tenantId,
          reconciliationMatches.bankTransactionId,
          reconciliationMatches.documentId,
        ],
        set: {
          status: ReconciliationMatchStatus.MANUAL_MATCHED,
          matchedBy: ctx.userId,
          matchedAt,
          rule: 'manual',
          evidence: evidence as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      })
      .returning();

    await this.eventPublisher.publish(ReconciliationEvents.MANUAL_MATCH, {
      tenantId: ctx.tenantId,
      matchId: created.id,
      bankTransactionId: dto.bankTransactionId,
      documentId: dto.documentId,
      matchedBy: ctx.userId,
      matchedAt: matchedAt.toISOString(),
    });

    return this.getReviewItemDetail(ctx.tenantId, created.id);
  }

  /**
   * Obtiene métricas agregadas del motor de conciliación.
   * Si no hay datos registrados, devuelve hasData=false y tasas en null.
   */
  async getMetrics(
    ctx: RequestContext,
    from?: string,
    to?: string,
  ): Promise<ReconciliationMetricsResponse> {
    const runsFilter = [
      eq(reconciliationRuns.tenantId, ctx.tenantId),
      from ? sql`${reconciliationRuns.startedAt} >= ${from}` : sql`1=1`,
      to ? sql`${reconciliationRuns.startedAt} <= ${to}` : sql`1=1`,
    ];

    const runsList = await this.db
      .select()
      .from(reconciliationRuns)
      .where(and(...runsFilter))
      .orderBy(desc(reconciliationRuns.createdAt))
      .limit(10);

    const matchesFilter = [
      eq(reconciliationMatches.tenantId, ctx.tenantId),
      from ? sql`${reconciliationMatches.createdAt} >= ${from}` : sql`1=1`,
      to ? sql`${reconciliationMatches.createdAt} <= ${to}` : sql`1=1`,
    ];

    const matchCounts = await this.db
      .select({
        status: reconciliationMatches.status,
        count: sql<number>`count(*)`,
      })
      .from(reconciliationMatches)
      .where(and(...matchesFilter))
      .groupBy(reconciliationMatches.status);

    let totalAutoMatched = 0;
    let totalNeedsReview = 0;
    let totalManualMatched = 0;
    let totalRejected = 0;

    for (const item of matchCounts) {
      const count = Number(item.count);
      switch (item.status) {
        case ReconciliationMatchStatus.AUTO_MATCHED:
          totalAutoMatched = count;
          break;
        case ReconciliationMatchStatus.NEEDS_REVIEW:
          totalNeedsReview = count;
          break;
        case ReconciliationMatchStatus.MANUAL_MATCHED:
          totalManualMatched = count;
          break;
        case ReconciliationMatchStatus.REJECTED:
          totalRejected = count;
          break;
      }
    }

    const totalMatches = totalAutoMatched + totalNeedsReview + totalManualMatched + totalRejected;

    // Calcular errores y procesados desde los runs
    let totalProcessed = 0;
    let totalErrors = 0;
    for (const run of runsList) {
      totalProcessed += run.processed;
      totalErrors += run.errors + (run.status === ReconciliationRunStatus.FAILED ? 1 : 0);
    }

    const totalRuns = runsList.length;

    // Si no hay datos registrados, devolver hasData=false y tasas nulas
    if (totalMatches === 0 && totalRuns === 0) {
      return {
        hasData: false,
        autoMatchRate: null,
        reviewRate: null,
        totalProcessed: 0,
        totalAutoMatched: 0,
        totalNeedsReview: 0,
        totalManualMatched: 0,
        totalRejected: 0,
        totalErrors: 0,
        totalRuns: 0,
        runs: [],
        from: from ?? null,
        to: to ?? null,
      };
    }

    const eligibleForRate = totalAutoMatched + totalNeedsReview + totalManualMatched;
    const autoMatchRate =
      eligibleForRate > 0 ? Number((totalAutoMatched / eligibleForRate).toFixed(4)) : null;

    const reviewRate =
      eligibleForRate > 0 ? Number((totalNeedsReview / eligibleForRate).toFixed(4)) : null;

    return {
      hasData: true,
      autoMatchRate,
      reviewRate,
      totalProcessed,
      totalAutoMatched,
      totalNeedsReview,
      totalManualMatched,
      totalRejected,
      totalErrors,
      totalRuns,
      runs: runsList.map((r) => this.mapRunResponse(r)),
      from: from ?? null,
      to: to ?? null,
    };
  }

  private async getOrCreateSettings(tenantId: string): Promise<DbReconciliationSettings> {
    const [found] = await this.db
      .select()
      .from(reconciliationSettings)
      .where(eq(reconciliationSettings.tenantId, tenantId))
      .limit(1);

    if (found) {
      return found;
    }

    const [created] = await this.db
      .insert(reconciliationSettings)
      .values({
        tenantId,
        dateWindowDays: DEFAULT_DATE_WINDOW_DAYS,
        autoMatchThresholdBps: DEFAULT_AUTO_MATCH_THRESHOLD_BPS,
        timezone: DEFAULT_TIMEZONE,
        lookbackDays: DEFAULT_LOOKBACK_DAYS,
        nightlyEnabled: true,
      })
      .onConflictDoUpdate({
        target: [reconciliationSettings.tenantId],
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();

    return created;
  }

  private async getReviewItemDetail(
    tenantId: string,
    matchId: string,
  ): Promise<ReconciliationReviewItemResponse> {
    const [row] = await this.db
      .select({
        match: reconciliationMatches,
        tx: bankTransactions,
        doc: documents,
        inv: invoices,
      })
      .from(reconciliationMatches)
      .innerJoin(bankTransactions, eq(reconciliationMatches.bankTransactionId, bankTransactions.id))
      .innerJoin(documents, eq(reconciliationMatches.documentId, documents.id))
      .leftJoin(invoices, eq(reconciliationMatches.invoiceId, invoices.id))
      .where(
        and(eq(reconciliationMatches.id, matchId), eq(reconciliationMatches.tenantId, tenantId)),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Match de conciliación no encontrado.');
    }

    return this.mapReviewItemResponse(row.match, row.tx, row.doc, row.inv);
  }

  private mapSettingsResponse(s: DbReconciliationSettings): ReconciliationSettingsResponse {
    return {
      tenantId: s.tenantId,
      dateWindowDays: s.dateWindowDays,
      autoMatchThresholdBps: s.autoMatchThresholdBps,
      timezone: s.timezone,
      lookbackDays: s.lookbackDays,
      nightlyEnabled: s.nightlyEnabled,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private mapRunResponse(r: typeof reconciliationRuns.$inferSelect): ReconciliationRunResponse {
    return {
      id: r.id,
      tenantId: r.tenantId,
      trigger: r.trigger as ReconciliationTrigger,
      status: r.status as ReconciliationRunStatus,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      processed: r.processed,
      autoMatched: r.autoMatched,
      needsReview: r.needsReview,
      errors: r.errors,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private mapReviewItemResponse(
    m: ReconciliationMatch,
    tx?: typeof bankTransactions.$inferSelect | null,
    doc?: typeof documents.$inferSelect | null,
    inv?: typeof invoices.$inferSelect | null,
  ): ReconciliationReviewItemResponse {
    return {
      id: m.id,
      tenantId: m.tenantId,
      bankTransactionId: m.bankTransactionId,
      documentId: m.documentId,
      invoiceId: m.invoiceId,
      status: m.status as ReconciliationMatchStatus,
      score: Number(m.score),
      rule: m.rule,
      evidence: m.evidence as unknown as ReconciliationEvidence,
      matchedBy: m.matchedBy,
      matchedAt: m.matchedAt ? m.matchedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      bankTransaction: tx
        ? {
            id: tx.id,
            amountMinor: tx.amountMinor.toString(),
            isoCurrencyCode: tx.isoCurrencyCode,
            date: tx.date,
            name: tx.name,
            merchantName: tx.merchantName,
          }
        : undefined,
      document: doc
        ? {
            id: doc.id,
            originalName: doc.originalName,
            providerName: doc.providerName,
            taxId: doc.taxId,
            issueDate: doc.issueDate,
            currency: doc.currency,
            totalMinor: doc.totalMinor === null ? null : doc.totalMinor.toString(),
            confidence: doc.confidence === null ? null : Number(doc.confidence),
            invoiceNumber: doc.invoiceNumber,
            status: doc.status,
          }
        : undefined,
      invoice: inv
        ? {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            totalAmountMinor: inv.totalAmountMinor.toString(),
            currency: inv.currency,
            status: inv.status,
          }
        : null,
    };
  }
}

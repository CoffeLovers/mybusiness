import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  AuditEvents,
  LedgerReconciliationStatus,
  LedgerSortField,
  type BulkCategorizeDto,
  type LedgerCsvExportResponse,
  type LedgerEvidence,
  type LedgerPageResponse,
  type LedgerQueryDto,
  type LedgerRowResponse,
  type RequestContext,
  type SaveLedgerViewDto,
  type SavedLedgerViewResponse,
  type UpdateLedgerTransactionDto,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import {
  bankAccounts,
  bankTransactions,
  documents,
  ledgerSavedViews,
  reconciliationMatches,
} from '../database/schema';
import { DomainEventPublisher } from '../events/domain-event.publisher';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = 50_000;
export const MAX_BULK = 500;

/** Prioridad de estados al elegir el match "principal" de una transacción. */
const MATCH_STATUS_PRIORITY: Record<string, number> = {
  MANUAL_MATCHED: 0,
  AUTO_MATCHED: 1,
  NEEDS_REVIEW: 2,
  REJECTED: 3,
};

/** Columnas ordenables (whitelist; nunca se interpola SQL del cliente). */
type SortDirection = 'asc' | 'desc';

interface LedgerSourceRow {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  category: string[] | null;
  notes: string | null;
  amountMinor: bigint;
  isoCurrencyCode: string;
  accountId: string;
  accountName: string | null;
  institutionName: string;
  updatedAt: Date;
}

interface MatchSourceRow {
  id: string;
  bankTransactionId: string;
  documentId: string;
  status: string;
  score: string;
  rule: string;
  matchedAt: Date | null;
  documentName: string;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly databaseService: FinanceDatabaseService,
    private readonly events: DomainEventPublisher,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  // ---------------------------------------------------------------------------
  // Listado paginado
  // ---------------------------------------------------------------------------

  async list(ctx: RequestContext, query: LedgerQueryDto): Promise<LedgerPageResponse> {
    const tenantId = this.requireTenant(ctx);

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const conditions = this.buildConditions(tenantId, query);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
      .where(and(...conditions));

    const rows = await this.fetchRows(
      conditions,
      query.sortBy ?? LedgerSortField.DATE,
      query.sortDir ?? 'desc',
      pageSize,
      offset,
    );

    this.logger.log(`Libro mayor tenant=${tenantId} filas=${rows.length} total=${total}`);

    return {
      rows,
      total,
      page,
      pageSize,
      hasMore: offset + rows.length < total,
    };
  }

  // ---------------------------------------------------------------------------
  // Exportación CSV
  // ---------------------------------------------------------------------------

  async exportCsv(ctx: RequestContext, query: LedgerQueryDto): Promise<LedgerCsvExportResponse> {
    const tenantId = this.requireTenant(ctx);
    const conditions = this.buildConditions(tenantId, query);

    const rows = await this.fetchRows(
      conditions,
      query.sortBy ?? LedgerSortField.DATE,
      query.sortDir ?? 'desc',
      MAX_EXPORT_ROWS,
      0,
    );

    const header = [
      'fecha',
      'descripcion',
      'contraparte',
      'categoria',
      'monto',
      'moneda',
      'estado_conciliacion',
      'evidencia',
    ];

    const lines = [header.map((cell) => this.csvCell(cell)).join(',')];

    for (const row of rows) {
      lines.push(
        [
          row.date.slice(0, 10),
          row.name,
          row.merchantName ?? '',
          row.category ?? '',
          row.amountMinor,
          row.isoCurrencyCode,
          row.reconciliationStatus,
          row.evidence ? row.evidence.documentName : '',
        ]
          .map((cell) => this.csvCell(cell))
          .join(','),
      );
    }

    const content = `\uFEFF${lines.join('\r\n')}\r\n`;
    const filename = `libro-mayor-${this.utcDateStamp()}.csv`;

    this.logger.log(`Libro mayor export tenant=${tenantId} filas=${rows.length}`);

    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      content,
      rowCount: rows.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Edición manual
  // ---------------------------------------------------------------------------

  async update(
    ctx: RequestContext,
    transactionId: string,
    dto: UpdateLedgerTransactionDto,
  ): Promise<LedgerRowResponse> {
    const tenantId = this.requireTenant(ctx);

    if (dto.category === undefined && dto.notes === undefined) {
      throw new BadRequestException('Debe indicar al menos category o notes.');
    }

    const [previous] = await this.db
      .select({
        id: bankTransactions.id,
        category: bankTransactions.category,
        notes: bankTransactions.notes,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankAccounts.tenantId, tenantId),
          isNull(bankTransactions.removedAt),
        ),
      )
      .limit(1);

    if (!previous) {
      throw new NotFoundException('La transacción no existe.');
    }

    const prevCategory = previous.category ?? null;
    const prevNotes = previous.notes ?? null;

    const set: { category?: string[]; notes?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    let nextCategory = prevCategory;
    if (dto.category !== undefined) {
      nextCategory = dto.category.trim() === '' ? [] : [dto.category];
      set.category = nextCategory;
    }

    let nextNotes = prevNotes;
    if (dto.notes !== undefined) {
      nextNotes = dto.notes.trim() === '' ? null : dto.notes;
      set.notes = nextNotes;
    }

    await this.db
      .update(bankTransactions)
      .set(set)
      .where(and(eq(bankTransactions.id, transactionId), isNull(bankTransactions.removedAt)));

    // Best-effort: el publisher ya captura sus propios errores.
    await this.events.publish(AuditEvents.LOG_EVENT, {
      eventId: randomUUID(),
      tenantId,
      userId: ctx.userId,
      role: ctx.role,
      action: 'ledger.transaction.updated',
      entityName: 'bank_transaction',
      entityId: transactionId,
      oldValues: { category: prevCategory, notes: prevNotes },
      newValues: { category: nextCategory, notes: nextNotes },
      timestamp: new Date().toISOString(),
    });

    const row = await this.fetchRow(tenantId, transactionId);
    if (!row) {
      throw new NotFoundException('La transacción no existe.');
    }

    return row;
  }

  // ---------------------------------------------------------------------------
  // Categorización masiva
  // ---------------------------------------------------------------------------

  async bulkCategorize(
    ctx: RequestContext,
    dto: BulkCategorizeDto,
  ): Promise<{ updated: number; requested: number }> {
    const tenantId = this.requireTenant(ctx);

    if (dto.ids.length > MAX_BULK) {
      throw new BadRequestException(`No se pueden actualizar más de ${MAX_BULK} transacciones.`);
    }

    const category = dto.category.trim();
    if (category.length === 0) {
      throw new BadRequestException('La categoría no puede estar vacía.');
    }

    const result = await this.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: bankTransactions.id, category: bankTransactions.category })
        .from(bankTransactions)
        .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
        .where(
          and(
            eq(bankAccounts.tenantId, tenantId),
            isNull(bankTransactions.removedAt),
            inArray(bankTransactions.id, dto.ids),
          ),
        );

      if (found.length === 0) {
        return { foundIds: [] as string[], categories: {} as Record<string, string | null> };
      }

      const categories: Record<string, string | null> = {};
      for (const row of found) {
        categories[row.id] = row.category && row.category.length > 0 ? row.category[0] : null;
      }

      const foundIds = found.map((row) => row.id);

      await tx
        .update(bankTransactions)
        .set({ category: [category], updatedAt: new Date() })
        .where(and(inArray(bankTransactions.id, foundIds), isNull(bankTransactions.removedAt)));

      return { foundIds, categories };
    });

    if (result.foundIds.length > 0) {
      await this.events.publish(AuditEvents.LOG_EVENT, {
        eventId: randomUUID(),
        tenantId,
        userId: ctx.userId,
        role: ctx.role,
        action: 'ledger.transactions.bulk_categorized',
        entityName: 'bank_transaction',
        entityId: result.foundIds[0],
        newValues: { ids: result.foundIds, category },
        oldValues: { categories: result.categories },
        timestamp: new Date().toISOString(),
      });
    }

    return { updated: result.foundIds.length, requested: dto.ids.length };
  }

  // ---------------------------------------------------------------------------
  // Vistas guardadas
  // ---------------------------------------------------------------------------

  async listSavedViews(ctx: RequestContext): Promise<SavedLedgerViewResponse[]> {
    const tenantId = this.requireTenant(ctx);

    const rows = await this.db
      .select()
      .from(ledgerSavedViews)
      .where(and(eq(ledgerSavedViews.tenantId, tenantId), eq(ledgerSavedViews.userId, ctx.userId)))
      .orderBy(asc(ledgerSavedViews.name));

    return rows.map((row) => this.mapSavedView(row));
  }

  async createSavedView(
    ctx: RequestContext,
    dto: SaveLedgerViewDto,
  ): Promise<SavedLedgerViewResponse> {
    const tenantId = this.requireTenant(ctx);
    const query = this.sanitizeQuery(dto.query) as unknown as Record<string, unknown>;
    const now = new Date();

    const [row] = await this.db
      .insert(ledgerSavedViews)
      .values({
        tenantId,
        userId: ctx.userId,
        name: dto.name,
        query,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [ledgerSavedViews.tenantId, ledgerSavedViews.userId, ledgerSavedViews.name],
        set: { query, updatedAt: now },
      })
      .returning();

    return this.mapSavedView(row);
  }

  async deleteSavedView(ctx: RequestContext, viewId: string): Promise<{ deleted: boolean }> {
    const tenantId = this.requireTenant(ctx);

    const deleted = await this.db
      .delete(ledgerSavedViews)
      .where(
        and(
          eq(ledgerSavedViews.id, viewId),
          eq(ledgerSavedViews.tenantId, tenantId),
          eq(ledgerSavedViews.userId, ctx.userId),
        ),
      )
      .returning({ id: ledgerSavedViews.id });

    if (deleted.length === 0) {
      throw new NotFoundException('La vista guardada no existe.');
    }

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers de consulta
  // ---------------------------------------------------------------------------

  private requireTenant(ctx: RequestContext): string {
    if (!ctx.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto.');
    }
    return ctx.tenantId;
  }

  /**
   * Construye el `WHERE` común a listado y exportación. Todos los valores del
   * cliente viajan como parámetros de Drizzle; sólo el orden y el estado de
   * conciliación provienen de enums validados.
   */
  private buildConditions(tenantId: string, query: LedgerQueryDto): SQL[] {
    const conditions: SQL[] = [
      eq(bankAccounts.tenantId, tenantId),
      isNull(bankTransactions.removedAt),
    ];

    if (query.accountId) {
      conditions.push(eq(bankTransactions.accountId, query.accountId));
    }

    if (query.from) {
      conditions.push(gte(bankTransactions.date, query.from.slice(0, 10)));
    }

    if (query.to) {
      conditions.push(lte(bankTransactions.date, query.to.slice(0, 10)));
    }

    if (query.q) {
      const pattern = `%${query.q}%`;
      const textMatch = or(
        ilike(bankTransactions.name, pattern),
        ilike(bankTransactions.merchantName, pattern),
      );
      if (textMatch) {
        conditions.push(textMatch);
      }
    }

    if (query.category) {
      // El filtro por categoría usa el primer elemento del array jsonb.
      conditions.push(
        sql`${bankTransactions.category} @> ${JSON.stringify([query.category])}::jsonb`,
      );
    }

    if (query.reconciliationStatus) {
      // Filtro por estado de conciliación mediante EXISTS/NOT EXISTS sobre
      // `reconciliation_matches`. Se evita el JOIN en la consulta principal para
      // no duplicar filas cuando una transacción tiene varios candidatos.
      //   - UNMATCHED: no existe ningún match para la transacción.
      //   - Resto: existe un match con ese estado exacto.
      if (query.reconciliationStatus === LedgerReconciliationStatus.UNMATCHED) {
        conditions.push(
          sql`NOT EXISTS (
            SELECT 1 FROM reconciliation_matches m
            WHERE m.bank_transaction_id = ${bankTransactions.id}
          )`,
        );
      } else {
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM reconciliation_matches m
            WHERE m.bank_transaction_id = ${bankTransactions.id}
              AND m.status::text = ${query.reconciliationStatus}
          )`,
        );
      }
    }

    return conditions;
  }

  private async fetchRows(
    conditions: SQL[],
    sortBy: LedgerSortField,
    sortDir: SortDirection,
    limit: number,
    offset: number,
  ): Promise<LedgerRowResponse[]> {
    const rows = await this.db
      .select({
        id: bankTransactions.id,
        date: bankTransactions.date,
        name: bankTransactions.name,
        merchantName: bankTransactions.merchantName,
        category: bankTransactions.category,
        notes: bankTransactions.notes,
        amountMinor: bankTransactions.amountMinor,
        isoCurrencyCode: bankTransactions.isoCurrencyCode,
        accountId: bankTransactions.accountId,
        accountName: bankAccounts.name,
        institutionName: bankAccounts.institutionName,
        updatedAt: bankTransactions.updatedAt,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
      .where(and(...conditions))
      .orderBy(...this.buildOrder(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    const matches = await this.loadMatches(rows.map((row) => row.id));
    return rows.map((row) => this.mapRow(row, matches.get(row.id)));
  }

  private async fetchRow(
    tenantId: string,
    transactionId: string,
  ): Promise<LedgerRowResponse | null> {
    const [row] = await this.db
      .select({
        id: bankTransactions.id,
        date: bankTransactions.date,
        name: bankTransactions.name,
        merchantName: bankTransactions.merchantName,
        category: bankTransactions.category,
        notes: bankTransactions.notes,
        amountMinor: bankTransactions.amountMinor,
        isoCurrencyCode: bankTransactions.isoCurrencyCode,
        accountId: bankTransactions.accountId,
        accountName: bankAccounts.name,
        institutionName: bankAccounts.institutionName,
        updatedAt: bankTransactions.updatedAt,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankTransactions.accountId, bankAccounts.id))
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankAccounts.tenantId, tenantId),
          isNull(bankTransactions.removedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    const matches = await this.loadMatches([row.id]);
    return this.mapRow(row, matches.get(row.id));
  }

  /** Orden whitelisted + desempate por id para paginación estable. */
  private buildOrder(sortBy: LedgerSortField, sortDir: SortDirection): SQL[] {
    const column = this.sortColumn(sortBy);
    const isAsc = sortDir === 'asc';
    return [
      isAsc ? asc(column) : desc(column),
      isAsc ? asc(bankTransactions.id) : desc(bankTransactions.id),
    ];
  }

  private sortColumn(sortBy: LedgerSortField): SQL {
    switch (sortBy) {
      case LedgerSortField.AMOUNT:
        return sql`${bankTransactions.amountMinor}`;
      case LedgerSortField.NAME:
        return sql`${bankTransactions.name}`;
      case LedgerSortField.CATEGORY:
        return sql`coalesce(${bankTransactions.category}->>0, '')`;
      case LedgerSortField.STATUS:
        return sql`coalesce((
          SELECT m.status::text FROM reconciliation_matches m
          WHERE m.bank_transaction_id = ${bankTransactions.id}
          ORDER BY m.score DESC, m.created_at DESC
          LIMIT 1
        ), 'UNMATCHED')`;
      case LedgerSortField.DATE:
      default:
        return sql`${bankTransactions.date}`;
    }
  }

  /**
   * Carga en lote los matches de una página y elige uno por transacción
   * (prioridad de estado y, a igualdad, mayor score).
   */
  private async loadMatches(ids: string[]): Promise<Map<string, MatchSourceRow>> {
    const result = new Map<string, MatchSourceRow>();
    if (ids.length === 0) {
      return result;
    }

    const matches = await this.db
      .select({
        id: reconciliationMatches.id,
        bankTransactionId: reconciliationMatches.bankTransactionId,
        documentId: reconciliationMatches.documentId,
        status: reconciliationMatches.status,
        score: reconciliationMatches.score,
        rule: reconciliationMatches.rule,
        matchedAt: reconciliationMatches.matchedAt,
        documentName: documents.originalName,
      })
      .from(reconciliationMatches)
      .innerJoin(documents, eq(reconciliationMatches.documentId, documents.id))
      .where(inArray(reconciliationMatches.bankTransactionId, ids));

    for (const match of matches) {
      const current = result.get(match.bankTransactionId);
      if (!current || this.isBetterMatch(match, current)) {
        result.set(match.bankTransactionId, match);
      }
    }

    return result;
  }

  private isBetterMatch(candidate: MatchSourceRow, current: MatchSourceRow): boolean {
    const candidatePriority = MATCH_STATUS_PRIORITY[candidate.status] ?? Number.MAX_SAFE_INTEGER;
    const currentPriority = MATCH_STATUS_PRIORITY[current.status] ?? Number.MAX_SAFE_INTEGER;
    if (candidatePriority !== currentPriority) {
      return candidatePriority < currentPriority;
    }
    return Number(candidate.score) > Number(current.score);
  }

  private mapRow(row: LedgerSourceRow, match: MatchSourceRow | undefined): LedgerRowResponse {
    let evidence: LedgerEvidence | null = null;
    if (match) {
      evidence = {
        documentId: match.documentId,
        documentName: match.documentName,
        score: Number(match.score),
        rule: match.rule,
        matchedAt: match.matchedAt ? match.matchedAt.toISOString() : null,
      };
    }

    return {
      id: row.id,
      date: row.date.slice(0, 10),
      name: row.name,
      merchantName: row.merchantName,
      category: row.category && row.category.length > 0 ? row.category[0] : null,
      notes: row.notes,
      amountMinor: row.amountMinor.toString(),
      isoCurrencyCode: row.isoCurrencyCode,
      accountId: row.accountId,
      accountName: row.accountName ?? row.institutionName,
      reconciliationStatus: match
        ? (match.status as LedgerReconciliationStatus)
        : LedgerReconciliationStatus.UNMATCHED,
      evidence,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapSavedView(row: {
    id: string;
    name: string;
    query: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }): SavedLedgerViewResponse {
    return {
      id: row.id,
      name: row.name,
      query: this.sanitizeQuery(row.query as unknown as LedgerQueryDto),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Reduce el query a un objeto plano con sólo las claves conocidas y sin
   * `undefined` antes de persistirlo en jsonb.
   */
  private sanitizeQuery(query: LedgerQueryDto): LedgerQueryDto {
    const result: LedgerQueryDto = {};

    if (typeof query.page === 'number' && Number.isFinite(query.page)) {
      result.page = Math.max(1, Math.trunc(query.page));
    }
    if (typeof query.pageSize === 'number' && Number.isFinite(query.pageSize)) {
      result.pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize)));
    }
    if (query.sortBy && Object.values(LedgerSortField).includes(query.sortBy)) {
      result.sortBy = query.sortBy;
    }
    if (query.sortDir === 'asc' || query.sortDir === 'desc') {
      result.sortDir = query.sortDir;
    }
    if (typeof query.from === 'string' && query.from.length > 0) {
      result.from = query.from;
    }
    if (typeof query.to === 'string' && query.to.length > 0) {
      result.to = query.to;
    }
    if (typeof query.q === 'string' && query.q.length > 0) {
      result.q = query.q;
    }
    if (typeof query.category === 'string' && query.category.length > 0) {
      result.category = query.category;
    }
    if (
      query.reconciliationStatus &&
      Object.values(LedgerReconciliationStatus).includes(query.reconciliationStatus)
    ) {
      result.reconciliationStatus = query.reconciliationStatus;
    }
    if (typeof query.accountId === 'string' && query.accountId.length > 0) {
      result.accountId = query.accountId;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers CSV
  // ---------------------------------------------------------------------------

  /** Escapa RFC 4180 y neutraliza fórmulas (CSV injection). */
  private csvCell(rawValue: string): string {
    let value = rawValue;
    if (/^[=+\-@]/.test(value)) {
      value = `'${value}`;
    }
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private utcDateStamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}

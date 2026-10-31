import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  BankAccountResponse,
  BankConnectionResponse,
  BankConnectionStatus,
  BankProvider,
  ExchangeBankConnectionDto,
  RequestContext,
  StartBankConnectionDto,
  StartBankConnectionResponse,
  SyncConnectionResponse,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import {
  bankAccounts,
  bankConnections,
  bankTransactionSyncState,
  type BankAccount,
  type BankConnection,
} from '../database/schema';
import { BankingAggregatorService } from './banking-aggregator.service';
import { BankingEncryptionService } from './banking-encryption.service';
import { BankingSyncService } from './banking-sync.service';

@Injectable()
export class BankingService {
  private readonly logger = new Logger(BankingService.name);

  constructor(
    private readonly databaseService: FinanceDatabaseService,
    private readonly aggregatorService: BankingAggregatorService,
    private readonly encryptionService: BankingEncryptionService,
    private readonly syncService: BankingSyncService,
    private readonly configService: ConfigService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  /**
   * Inicia el flujo de conexión bancaria obteniendo un link_token o credencial temporal
   * según el proveedor (Plaid Link / Belvo Widget).
   */
  async createLinkOrConnect(
    ctx: RequestContext,
    dto: StartBankConnectionDto,
  ): Promise<StartBankConnectionResponse> {
    const adapter = this.aggregatorService.getAdapter(dto.provider);

    const result = await adapter.createLinkOrConnect({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      institutionId: dto.institutionId,
    });

    return {
      provider: dto.provider,
      linkToken: result.linkToken,
      expiration: result.expiration,
    };
  }

  /**
   * Intercambia el token público (public_token en Plaid o link_id en Belvo) por un
   * access_token permanente, lo cifra con AES-256-GCM y registra la conexión y sus cuentas.
   * NUNCA expone el access_token al exterior.
   */
  async exchange(
    ctx: RequestContext,
    dto: ExchangeBankConnectionDto,
  ): Promise<BankConnectionResponse> {
    const adapter = this.aggregatorService.getAdapter(dto.provider);

    const exchangeResult = await adapter.exchange({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      publicToken: dto.publicToken,
      institution: dto.institution,
      linkId: dto.linkId,
      metadata: dto.metadata,
    });

    // 1. Cifrar access_token con AES-256-GCM
    const encrypted = await this.encryptionService.encrypt(exchangeResult.accessToken);
    const environment = this.configService.get<string>('PLAID_ENV', 'sandbox');

    // 2. Guardar conexión con status 'pending' (manejando duplicados con 409 Conflict)
    let connection: typeof bankConnections.$inferSelect;
    try {
      const [inserted] = await this.db
        .insert(bankConnections)
        .values({
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          provider: dto.provider,
          providerItemId: exchangeResult.providerItemId,
          accessTokenCiphertext: encrypted.ciphertext,
          tokenKeyVersion: encrypted.keyVersion,
          institutionId: exchangeResult.institutionId,
          institutionName: exchangeResult.institutionName,
          environment,
          status: BankConnectionStatus.PENDING,
          rawMetadata: exchangeResult.rawMetadata || {},
        })
        .returning();
      connection = inserted;
    } catch (err: unknown) {
      const dbErr = err as { code?: string; message?: string };
      if (
        dbErr?.code === '23505' ||
        dbErr?.message?.includes('bank_connections_provider_env_item_uq') ||
        dbErr?.message?.includes('duplicate key')
      ) {
        throw new ConflictException(
          'Esta cuenta bancaria ya ha sido vinculada previamente en este entorno.',
        );
      }
      throw err;
    }

    // 3. Inicializar bank_transaction_sync_state
    await this.db
      .insert(bankTransactionSyncState)
      .values({
        connectionId: connection.id,
      })
      .onConflictDoNothing();

    // 4. Obtener cuentas y normalizarlas
    let normalizedAccounts = exchangeResult.accounts;
    let accountsSyncFailed = false;

    if (!normalizedAccounts || normalizedAccounts.length === 0) {
      try {
        normalizedAccounts = await adapter.getAccounts({
          accessToken: exchangeResult.accessToken,
          providerItemId: exchangeResult.providerItemId,
        });
      } catch (err: unknown) {
        accountsSyncFailed = true;
        this.logger.warn(
          `No se pudieron sincronizar las cuentas inmediatamente en exchange: ${
            err instanceof Error ? err.message : 'Error'
          }`,
        );
      }
    }

    if (normalizedAccounts && normalizedAccounts.length > 0) {
      await this.syncService.syncAccounts(connection, normalizedAccounts);
    } else {
      accountsSyncFailed = true;
    }

    // 5. Pasar conexión a status 'active' o 'error' según resultado de obtención de cuentas
    const finalStatus = accountsSyncFailed
      ? BankConnectionStatus.ERROR
      : BankConnectionStatus.ACTIVE;

    const [finalConnection] = await this.db
      .update(bankConnections)
      .set({
        status: finalStatus,
        updatedAt: new Date(),
      })
      .where(eq(bankConnections.id, connection.id))
      .returning();

    return this.mapConnectionResponse(finalConnection);
  }

  /**
   * Obtiene todas las conexiones bancarias filtrando estrictamente por tenant y usuario (tenantId + userId).
   * Solo incluye registros activos (deletedAt IS NULL).
   */
  async getConnections(ctx: RequestContext): Promise<BankConnectionResponse[]> {
    const list = await this.db
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.userId, ctx.userId),
          eq(bankConnections.tenantId, ctx.tenantId),
          isNull(bankConnections.deletedAt),
        ),
      )
      .orderBy(desc(bankConnections.createdAt));

    return list.map((c) => this.mapConnectionResponse(c));
  }

  /**
   * Obtiene las cuentas vinculadas a una conexión específica,
   * validando estrictamente que pertenezca al tenant y usuario autenticado (ownership).
   */
  async getConnectionAccounts(
    ctx: RequestContext,
    connectionId: string,
  ): Promise<BankAccountResponse[]> {
    const connection = await this.findOwnedConnection(ctx, connectionId);

    const accounts = await this.db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.connectionId, connection.id), isNull(bankAccounts.deletedAt)))
      .orderBy(desc(bankAccounts.createdAt));

    return accounts.map((a) => this.mapAccountResponse(a));
  }

  /**
   * Sincroniza movimientos de una conexión validando ownership y cursor incremental.
   */
  async syncConnection(ctx: RequestContext, connectionId: string): Promise<SyncConnectionResponse> {
    const connection = await this.findOwnedConnection(ctx, connectionId);
    return this.executeConnectionSync(connection);
  }

  /**
   * Sincronización interna disparada por webhook (sin contexto HTTP de usuario).
   */
  async internalSyncConnection(connectionId: string): Promise<SyncConnectionResponse> {
    const [connection] = await this.db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, connectionId), isNull(bankConnections.deletedAt)))
      .limit(1);

    if (!connection) {
      throw new NotFoundException('Conexión bancaria no encontrada para sync interno.');
    }

    return this.executeConnectionSync(connection);
  }

  private async executeConnectionSync(connection: BankConnection): Promise<SyncConnectionResponse> {
    const adapter = this.aggregatorService.getAdapter(connection.provider as BankProvider);

    // Descifrar access_token
    const accessToken = await this.encryptionService.decrypt(
      connection.accessTokenCiphertext,
      connection.tokenKeyVersion,
    );

    // Obtener cursor actual
    const [syncState] = await this.db
      .select()
      .from(bankTransactionSyncState)
      .where(eq(bankTransactionSyncState.connectionId, connection.id))
      .limit(1);

    // Marcar inicio de sincronización
    await this.db
      .update(bankTransactionSyncState)
      .set({
        lastSyncStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bankTransactionSyncState.connectionId, connection.id));

    let cursor = syncState?.cursor ?? null;
    let hasMore = true;
    let pages = 0;
    const totals = { added: 0, modified: 0, removed: 0 };
    const maxPages = Number(this.configService.get('BANKING_SYNC_MAX_PAGES') ?? 50);
    const maxDurationMs = Number(this.configService.get('BANKING_SYNC_MAX_DURATION_MS') ?? 4000);
    const startedAt = Date.now();

    while (hasMore && pages < maxPages) {
      if (Date.now() - startedAt > maxDurationMs) {
        this.logger.warn(
          `Presupuesto de tiempo agotado para sync en conexión ${connection.id} (${Date.now() - startedAt}ms). Se devolverá hasMore=true para reanudar.`,
        );
        break;
      }

      const page = await adapter.syncTransactions({
        accessToken,
        cursor,
        count: 100,
      });

      const counts = await this.syncService.applyTransactionsSync(connection, page);

      totals.added += counts.added;
      totals.modified += counts.modified;
      totals.removed += counts.removed;
      pages++;

      if (page.hasMore && page.nextCursor && page.nextCursor === cursor) {
        this.logger.error(`Cursor repetido en conexión ${connection.id}; se detiene el sync.`);
        break;
      }

      cursor = page.nextCursor ?? null;
      hasMore = page.hasMore;
    }

    return {
      connectionId: connection.id,
      ...totals,
      hasMore,
      nextCursor: cursor,
    };
  }

  /**
   * Desconecta y revoca una conexión bancaria validando ownership.
   */
  async disconnectConnection(
    ctx: RequestContext,
    connectionId: string,
  ): Promise<{ success: boolean }> {
    const connection = await this.findOwnedConnection(ctx, connectionId);
    const adapter = this.aggregatorService.getAdapter(connection.provider as BankProvider);

    try {
      const accessToken = await this.encryptionService.decrypt(
        connection.accessTokenCiphertext,
        connection.tokenKeyVersion,
      );
      await adapter.disconnect({
        accessToken,
        providerItemId: connection.providerItemId,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Error al notificar desconexión al proveedor: ${err instanceof Error ? err.message : 'Error'}`,
      );
    }

    await this.db
      .update(bankConnections)
      .set({
        status: BankConnectionStatus.REVOKED,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bankConnections.id, connection.id));

    return { success: true };
  }

  private async findOwnedConnection(
    ctx: RequestContext,
    connectionId: string,
  ): Promise<BankConnection> {
    const [connection] = await this.db
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.id, connectionId),
          eq(bankConnections.userId, ctx.userId),
          eq(bankConnections.tenantId, ctx.tenantId),
          isNull(bankConnections.deletedAt),
        ),
      )
      .limit(1);

    if (!connection) {
      throw new NotFoundException('Conexión bancaria no encontrada o acceso denegado.');
    }

    return connection;
  }

  private mapConnectionResponse(c: BankConnection): BankConnectionResponse {
    return {
      id: c.id,
      provider: c.provider as BankProvider,
      institutionId: c.institutionId,
      institutionName: c.institutionName,
      status: c.status as BankConnectionStatus,
      lastSuccessfulSyncAt: c.lastSuccessfulSyncAt ? c.lastSuccessfulSyncAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private mapAccountResponse(a: BankAccount): BankAccountResponse {
    return {
      id: a.id,
      connectionId: a.connectionId || '',
      providerAccountId: a.providerAccountId || '',
      name: a.name || a.institutionName,
      officialName: a.officialName,
      type: a.type || a.accountType,
      subtype: a.subtype,
      mask: a.mask,
      isoCurrencyCode: a.isoCurrencyCode || a.currency,
      balanceCurrentMinor:
        a.balanceCurrent != null ? a.balanceCurrent.toString() : a.currentBalanceMinor.toString(),
      balanceAvailableMinor:
        a.balanceAvailable != null
          ? a.balanceAvailable.toString()
          : a.availableBalanceMinor.toString(),
      status: a.status,
    };
  }
}

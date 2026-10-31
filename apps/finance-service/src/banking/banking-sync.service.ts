import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { FinanceDatabaseService } from '../database/database.service';
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  bankTransactionSyncState,
  type BankAccount,
  type BankConnection,
} from '../database/schema';
import { NormalizedBankAccount, SyncTransactionsResult } from './adapters/base-adapter.interface';

@Injectable()
export class BankingSyncService {
  private readonly logger = new Logger(BankingSyncService.name);

  constructor(private readonly databaseService: FinanceDatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  /**
   * Normaliza y persiste/actualiza las cuentas vinculadas a una conexión bancaria.
   */
  async syncAccounts(
    connection: BankConnection,
    normalizedAccounts: NormalizedBankAccount[],
  ): Promise<BankAccount[]> {
    const tenantId = connection.tenantId;
    const syncedAccounts: BankAccount[] = [];

    for (const acc of normalizedAccounts) {
      const existing = await this.db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.connectionId, connection.id),
            eq(bankAccounts.providerAccountId, acc.providerAccountId),
          ),
        )
        .limit(1);

      const balanceCurrentMinor = acc.balanceCurrentMinor ?? 0n;
      const balanceAvailableMinor = acc.balanceAvailableMinor ?? balanceCurrentMinor;
      const mask = acc.mask || '0000';
      const maskedNumber = `****${mask}`;

      if (existing.length > 0) {
        const [updated] = await this.db
          .update(bankAccounts)
          .set({
            name: acc.name,
            officialName: acc.officialName,
            type: acc.type,
            subtype: acc.subtype,
            mask: acc.mask,
            isoCurrencyCode: acc.isoCurrencyCode,
            currency: acc.isoCurrencyCode || 'USD',
            balanceCurrent: balanceCurrentMinor,
            balanceAvailable: balanceAvailableMinor,
            currentBalanceMinor: balanceCurrentMinor,
            availableBalanceMinor: balanceAvailableMinor,
            rawMetadata: acc.rawMetadata || {},
            updatedAt: new Date(),
          })
          .where(eq(bankAccounts.id, existing[0].id))
          .returning();

        syncedAccounts.push(updated);
      } else {
        const [inserted] = await this.db
          .insert(bankAccounts)
          .values({
            tenantId,
            connectionId: connection.id,
            providerAccountId: acc.providerAccountId,
            institutionName: connection.institutionName || 'Entidad Bancaria',
            institutionCode: connection.institutionId,
            name: acc.name,
            officialName: acc.officialName,
            accountNumberMasked: maskedNumber,
            mask: acc.mask,
            currency: acc.isoCurrencyCode || 'USD',
            isoCurrencyCode: acc.isoCurrencyCode || 'USD',
            currentBalanceMinor: balanceCurrentMinor,
            availableBalanceMinor: balanceAvailableMinor,
            balanceCurrent: balanceCurrentMinor,
            balanceAvailable: balanceAvailableMinor,
            syncStatus: 'SYNCED',
            status: 'active',
            rawMetadata: acc.rawMetadata || {},
          })
          .returning();

        syncedAccounts.push(inserted);
      }
    }

    return syncedAccounts;
  }

  /**
   * Aplica de forma atómica e idempotente el lote de transacciones sincronizadas con cursor.
   * Actualiza el cursor únicamente tras el commit exitoso en base de datos.
   */
  async applyTransactionsSync(
    connection: BankConnection,
    syncResult: SyncTransactionsResult,
  ): Promise<{ added: number; modified: number; removed: number }> {
    return this.db.transaction(async (tx) => {
      // 1. Obtener mapeo de provider_account_id -> bank_accounts.id
      const accounts = await tx
        .select({
          id: bankAccounts.id,
          providerAccountId: bankAccounts.providerAccountId,
        })
        .from(bankAccounts)
        .where(eq(bankAccounts.connectionId, connection.id));

      const accountMap = new Map<string, string>();
      for (const a of accounts) {
        if (a.providerAccountId) {
          accountMap.set(a.providerAccountId, a.id);
        }
      }

      // 2. Procesar transacciones añadidas
      for (const item of syncResult.added) {
        const accountId = accountMap.get(item.providerAccountId);
        if (!accountId) {
          this.logger.warn(
            `Cuenta no encontrada para la transacción agregada (providerAccountId: ${item.providerAccountId}).`,
          );
          continue;
        }

        await tx
          .insert(bankTransactions)
          .values({
            accountId,
            connectionId: connection.id,
            providerTransactionId: item.providerTransactionId,
            amountMinor: item.amountMinor,
            transactionType: item.transactionType,
            isoCurrencyCode: item.isoCurrencyCode,
            date: item.date,
            authorizedDate: item.authorizedDate,
            name: item.name,
            merchantName: item.merchantName,
            category: item.category || [],
            pending: item.pending,
            rawMetadata: item.rawMetadata || {},
          })
          .onConflictDoUpdate({
            target: [bankTransactions.accountId, bankTransactions.providerTransactionId],
            set: {
              amountMinor: item.amountMinor,
              transactionType: item.transactionType,
              isoCurrencyCode: item.isoCurrencyCode,
              date: item.date,
              authorizedDate: item.authorizedDate,
              name: item.name,
              merchantName: item.merchantName,
              category: item.category || [],
              pending: item.pending,
              rawMetadata: item.rawMetadata || {},
              updatedAt: new Date(),
            },
          });
      }

      // 3. Procesar transacciones modificadas
      for (const item of syncResult.modified) {
        const accountId = accountMap.get(item.providerAccountId);
        if (!accountId) {
          continue;
        }

        await tx
          .update(bankTransactions)
          .set({
            amountMinor: item.amountMinor,
            transactionType: item.transactionType,
            isoCurrencyCode: item.isoCurrencyCode,
            date: item.date,
            authorizedDate: item.authorizedDate,
            name: item.name,
            merchantName: item.merchantName,
            category: item.category || [],
            pending: item.pending,
            rawMetadata: item.rawMetadata || {},
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bankTransactions.accountId, accountId),
              eq(bankTransactions.providerTransactionId, item.providerTransactionId),
            ),
          );
      }

      // 4. Procesar transacciones removidas
      for (const item of syncResult.removed) {
        await tx
          .update(bankTransactions)
          .set({
            removedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bankTransactions.connectionId, connection.id),
              eq(bankTransactions.providerTransactionId, item.providerTransactionId),
            ),
          );
      }

      // 5. Actualizar bank_transaction_sync_state
      const nextCursor = syncResult.nextCursor !== undefined ? syncResult.nextCursor : null;
      const initialComplete = !syncResult.hasMore;

      await tx
        .insert(bankTransactionSyncState)
        .values({
          connectionId: connection.id,
          cursor: nextCursor,
          lastSyncedAt: new Date(),
          lastSyncCompletedAt: new Date(),
          initialSyncComplete: initialComplete,
        })
        .onConflictDoUpdate({
          target: [bankTransactionSyncState.connectionId],
          set: {
            cursor: nextCursor,
            lastSyncedAt: new Date(),
            lastSyncCompletedAt: new Date(),
            ...(initialComplete ? { initialSyncComplete: true } : {}),
            updatedAt: new Date(),
          },
        });

      // 6. Actualizar timestamp de última sincronización en la conexión SÓLO si completó todas las páginas
      if (!syncResult.hasMore) {
        await tx
          .update(bankConnections)
          .set({
            lastSuccessfulSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(bankConnections.id, connection.id));
      }

      return {
        added: syncResult.added.length,
        modified: syncResult.modified.length,
        removed: syncResult.removed.length,
      };
    });
  }
}

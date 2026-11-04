import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ConfigService } from '@nestjs/config';
import { BankProvider, RequestContext, TransactionType, UserRole } from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../src/database/database.service';
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  bankTransactionSyncState,
  bankWebhookEvents,
  type BankAccount,
  type BankConnection,
} from '../src/database/schema';
import { BankingSyncService } from '../src/banking/banking-sync.service';
import { BankingService } from '../src/banking/banking.service';
import type { BankingAggregatorService } from '../src/banking/banking-aggregator.service';
import type { BankingEncryptionService } from '../src/banking/banking-encryption.service';
import type { SyncTransactionsResult } from '../src/banking/adapters/base-adapter.interface';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('Banking (integración PostgreSQL)', () => {
  let database: FinanceDatabaseService;
  let syncService: BankingSyncService;

  const userId = randomUUID();
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  let connectionA: BankConnection;
  let connectionB: BankConnection;
  let accountA: BankAccount;

  const webhookKeys = ['evt-1', 'evt-2'];

  beforeAll(async () => {
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    syncService = new BankingSyncService(database);

    const [insertedConnectionA] = await database.db
      .insert(bankConnections)
      .values({
        userId,
        tenantId: tenantA,
        provider: BankProvider.PLAID,
        providerItemId: `item-a-${randomUUID()}`,
        accessTokenCiphertext: 'x',
        status: 'active',
      })
      .returning();
    connectionA = insertedConnectionA;

    const [insertedAccountA] = await database.db
      .insert(bankAccounts)
      .values({
        tenantId: tenantA,
        connectionId: connectionA.id,
        providerAccountId: `acc-${randomUUID()}`,
        institutionName: 'Banco Tenant A',
        accountNumberMasked: '****1111',
        currency: 'EUR',
        currentBalanceMinor: 0n,
        availableBalanceMinor: 0n,
      })
      .returning();
    accountA = insertedAccountA;

    const [insertedConnectionB] = await database.db
      .insert(bankConnections)
      .values({
        userId,
        tenantId: tenantB,
        provider: BankProvider.PLAID,
        providerItemId: `item-b-${randomUUID()}`,
        accessTokenCiphertext: 'x',
        status: 'active',
      })
      .returning();
    connectionB = insertedConnectionB;
  });

  afterAll(async () => {
    const tenants = [tenantA, tenantB];
    await database.db
      .delete(bankTransactions)
      .where(inArray(bankTransactions.connectionId, [connectionA.id, connectionB.id]));
    await database.db
      .delete(bankWebhookEvents)
      .where(
        and(
          eq(bankWebhookEvents.provider, BankProvider.PLAID),
          inArray(bankWebhookEvents.providerEventKey, webhookKeys),
        ),
      );
    await database.db
      .delete(bankTransactionSyncState)
      .where(inArray(bankTransactionSyncState.connectionId, [connectionA.id, connectionB.id]));
    await database.db.delete(bankAccounts).where(inArray(bankAccounts.tenantId, tenants));
    await database.db.delete(bankConnections).where(inArray(bankConnections.tenantId, tenants));
    await database.onModuleDestroy();
  });

  it('persiste el importe monetario exacto y el cursor de sincronización', async () => {
    const result = await syncService.applyTransactionsSync(connectionA, {
      added: [
        {
          providerTransactionId: 't1',
          providerAccountId: accountA.providerAccountId as string,
          amountMinor: 2550n,
          transactionType: TransactionType.EXPENSE,
          isoCurrencyCode: 'EUR',
          date: '2026-10-01',
          name: 'Cafe',
          pending: false,
        },
      ],
      modified: [],
      removed: [],
      hasMore: false,
      nextCursor: 'c1',
    });

    expect(result).toEqual({ added: 1, modified: 0, removed: 0 });

    const raw = await database.db.execute<{ amount_minor: string; transaction_type: string }>(
      sql`select amount_minor::text as amount_minor, transaction_type
          from bank_transactions
          where connection_id = ${connectionA.id} and provider_transaction_id = 't1'`,
    );

    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].amount_minor).toBe('2550');
    expect(raw.rows[0].transaction_type).toBe('EXPENSE');

    const [state] = await database.db
      .select()
      .from(bankTransactionSyncState)
      .where(eq(bankTransactionSyncState.connectionId, connectionA.id));

    expect(state.cursor).toBe('c1');
    expect(state.initialSyncComplete).toBe(true);
  });

  it('es idempotente: reaplicar el mismo lote actualiza el importe sin duplicar filas', async () => {
    const batch: SyncTransactionsResult = {
      added: [
        {
          providerTransactionId: 't1',
          providerAccountId: accountA.providerAccountId as string,
          amountMinor: 3000n,
          transactionType: TransactionType.EXPENSE,
          isoCurrencyCode: 'EUR',
          date: '2026-10-01',
          name: 'Cafe',
          pending: false,
        },
      ],
      modified: [],
      removed: [],
      hasMore: false,
      nextCursor: 'c1',
    };

    await syncService.applyTransactionsSync(connectionA, batch);

    const rows = await database.db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.connectionId, connectionA.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].amountMinor).toBe(3000n);
  });

  it('marca removed_at cuando el proveedor elimina una transacción', async () => {
    await syncService.applyTransactionsSync(connectionA, {
      added: [],
      modified: [],
      removed: [{ providerTransactionId: 't1' }],
      hasMore: false,
      nextCursor: 'c1',
    });

    const [row] = await database.db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.connectionId, connectionA.id),
          eq(bankTransactions.providerTransactionId, 't1'),
        ),
      );

    expect(row.removedAt).not.toBeNull();
  });

  it('deduplica webhooks por (provider, provider_event_key)', async () => {
    const values = {
      provider: BankProvider.PLAID,
      providerEventKey: webhookKeys[0],
      webhookType: 'TRANSACTIONS',
    };

    await database.db.insert(bankWebhookEvents).values(values);

    let caught: unknown;
    try {
      await database.db.insert(bankWebhookEvents).values(values);
    } catch (error: unknown) {
      caught = error;
    }

    const dbError = caught as { code?: string; cause?: { code?: string } } | undefined;
    expect(dbError?.code ?? dbError?.cause?.code).toBe('23505');

    await expect(
      database.db.insert(bankWebhookEvents).values({ ...values, providerEventKey: webhookKeys[1] }),
    ).resolves.toBeDefined();
  });

  it('getConnections aísla por tenant aunque el usuario sea el mismo', async () => {
    const bankingService = new BankingService(
      database,
      {} as unknown as BankingAggregatorService,
      {} as unknown as BankingEncryptionService,
      {} as unknown as BankingSyncService,
      {} as unknown as ConfigService,
    );

    const ctxA: RequestContext = { tenantId: tenantA, userId, role: UserRole.TENANT_ADMIN };
    const connections = await bankingService.getConnections(ctxA);

    expect(connections).toHaveLength(1);
    expect(connections[0].id).toBe(connectionA.id);
  });
});

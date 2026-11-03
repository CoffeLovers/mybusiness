import { describe, expect, it, vi } from 'vitest';
import { TransactionType } from '@mybusiness/contracts';
import { BankingSyncService } from '../src/banking/banking-sync.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { BankConnection } from '../src/database/schema';
import type {
  NormalizedBankAccount,
  NormalizedBankTransaction,
  SyncTransactionsResult,
} from '../src/banking/adapters/base-adapter.interface';

type Row = Record<string, unknown>;

function asDatabaseService(db: object): FinanceDatabaseService {
  return { db } as unknown as FinanceDatabaseService;
}

function makeConnection(overrides: Partial<BankConnection> = {}): BankConnection {
  const now = new Date();
  return {
    id: 'conn-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    provider: 'plaid',
    providerItemId: 'item-1',
    accessTokenCiphertext: 'cipher',
    tokenKeyVersion: 'v1',
    institutionId: 'ins_1',
    institutionName: 'Banco de Prueba',
    environment: 'sandbox',
    status: 'active',
    consentedProducts: [],
    lastSuccessfulSyncAt: null,
    rawMetadata: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeTransaction(
  overrides: Partial<NormalizedBankTransaction> = {},
): NormalizedBankTransaction {
  return {
    providerTransactionId: 'tx-1',
    providerAccountId: 'p_acc_1',
    amountMinor: 1234n,
    transactionType: TransactionType.EXPENSE,
    isoCurrencyCode: 'USD',
    date: '2026-10-01',
    authorizedDate: '2026-10-01',
    name: 'Café',
    merchantName: 'Café Central',
    category: ['FOOD_AND_DRINK'],
    pending: false,
    rawMetadata: { source: 'plaid' },
    ...overrides,
  };
}

function makeAccount(overrides: Partial<NormalizedBankAccount> = {}): NormalizedBankAccount {
  return {
    providerAccountId: 'p_acc_1',
    name: 'Checking',
    officialName: 'Checking Oficial',
    type: 'depository',
    subtype: 'checking',
    mask: '1234',
    isoCurrencyCode: 'USD',
    balanceCurrentMinor: 100000n,
    balanceAvailableMinor: 90000n,
    rawMetadata: { balances: { current: 1000 } },
    ...overrides,
  };
}

interface ConflictConfig {
  target?: unknown;
  set?: Row;
}

/**
 * Mock encadenable de Drizzle para el contexto transaccional `tx`.
 * Registra cada insert/update y cada configuración de onConflictDoUpdate
 * para poder verificar los valores persistidos.
 */
function createTransactionMock(accountRows: Row[] = []) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const conflicts: ConflictConfig[] = [];

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(accountRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Row) => {
        inserts.push(values);
        return {
          onConflictDoUpdate: vi.fn((config: ConflictConfig) => {
            conflicts.push(config);
            return Promise.resolve([]);
          }),
          onConflictDoNothing: vi.fn().mockResolvedValue([]),
          returning: vi.fn().mockResolvedValue([{ id: 'acc-inserted', ...values }]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Row) => {
        updates.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'acc-1', ...values }]),
          })),
        };
      }),
    })),
  };

  return { tx, inserts, updates, conflicts };
}

function createDatabaseMock(tx: object) {
  const transaction = vi.fn((callback: (ctx: typeof tx) => Promise<unknown>) => callback(tx));
  return { db: { transaction }, transaction };
}

describe('BankingSyncService.applyTransactionsSync', () => {
  it('inserta transacciones añadidas cuando providerAccountId es conocido', async () => {
    const { tx, inserts } = createTransactionMock([{ id: 'acc-1', providerAccountId: 'p_acc_1' }]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    const result: SyncTransactionsResult = {
      added: [makeTransaction()],
      modified: [],
      removed: [],
      nextCursor: 'cursor-1',
      hasMore: false,
    };

    const counts = await service.applyTransactionsSync(makeConnection(), result);

    expect(counts).toEqual({ added: 1, modified: 0, removed: 0 });
    expect(inserts[0]).toMatchObject({
      accountId: 'acc-1',
      connectionId: 'conn-1',
      providerTransactionId: 'tx-1',
      amountMinor: 1234n,
      transactionType: TransactionType.EXPENSE,
    });
  });

  it('no inserta transacciones añadidas de cuentas desconocidas', async () => {
    const { tx, inserts } = createTransactionMock([]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    const counts = await service.applyTransactionsSync(makeConnection(), {
      added: [makeTransaction({ providerAccountId: 'p_acc_unknown' })],
      modified: [],
      removed: [],
      hasMore: false,
    });

    expect(counts.added).toBe(0);
    const transactionInserts = inserts.filter((row) => 'providerTransactionId' in row);
    expect(transactionInserts).toHaveLength(0);
  });

  it('aplica updates en modified y marca removedAt en removed', async () => {
    const { tx, updates } = createTransactionMock([{ id: 'acc-1', providerAccountId: 'p_acc_1' }]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    const counts = await service.applyTransactionsSync(makeConnection(), {
      added: [],
      modified: [makeTransaction({ amountMinor: 999n, name: 'Café corregido' })],
      removed: [{ providerTransactionId: 'tx-removed' }],
      hasMore: false,
    });

    expect(counts).toEqual({ added: 0, modified: 1, removed: 1 });
    expect(updates).toHaveLength(4);
    expect(updates[0]).toMatchObject({ amountMinor: 999n, name: 'Café corregido' });
    expect(updates[1].removedAt).toBeInstanceOf(Date);
    expect(updates[2].lastSyncedAt).toBeInstanceOf(Date);
    expect(updates[3].lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });

  it('ignora modified de cuentas no mapeadas', async () => {
    const { tx, updates } = createTransactionMock([]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    const counts = await service.applyTransactionsSync(makeConnection(), {
      added: [],
      modified: [makeTransaction({ providerAccountId: 'p_acc_unknown' })],
      removed: [],
      hasMore: false,
    });

    expect(counts.modified).toBe(0);
    // Se actualiza lastSyncedAt de las cuentas y lastSuccessfulSyncAt de la conexión.
    expect(updates).toHaveLength(2);
    expect(updates[0].lastSyncedAt).toBeInstanceOf(Date);
    expect(updates[1].lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });

  it('guarda el cursor y deja initialSyncComplete=false cuando hasMore es true', async () => {
    const { tx, inserts, conflicts, updates } = createTransactionMock([]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    await service.applyTransactionsSync(makeConnection(), {
      added: [],
      modified: [],
      removed: [],
      nextCursor: 'cursor-pagina-1',
      hasMore: true,
    });

    expect(inserts[0]).toMatchObject({
      connectionId: 'conn-1',
      cursor: 'cursor-pagina-1',
      initialSyncComplete: false,
    });
    expect(conflicts[0].set?.cursor).toBe('cursor-pagina-1');
    expect(conflicts[0].set).not.toHaveProperty('initialSyncComplete');
    expect(updates).toHaveLength(0);
  });

  it('fuerza initialSyncComplete=true y actualiza lastSuccessfulSyncAt cuando !hasMore', async () => {
    const { tx, inserts, conflicts, updates } = createTransactionMock([]);
    const { db } = createDatabaseMock(tx);
    const service = new BankingSyncService(asDatabaseService(db));

    await service.applyTransactionsSync(makeConnection(), {
      added: [],
      modified: [],
      removed: [],
      hasMore: false,
    });

    expect(inserts[0]).toMatchObject({ cursor: null, initialSyncComplete: true });
    expect(conflicts[0].set?.initialSyncComplete).toBe(true);
    expect(updates[0].lastSyncedAt).toBeInstanceOf(Date);
    expect(updates[1].lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });
});

describe('BankingSyncService.syncAccounts', () => {
  function createAccountsMock(existing: Row[]) {
    const inserts: Row[] = [];
    const updates: Row[] = [];

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(existing),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Row) => {
          inserts.push(values);
          return {
            returning: vi.fn().mockResolvedValue([{ id: 'acc-new', ...values }]),
            onConflictDoUpdate: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Row) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'acc-existing', ...values }]),
            })),
          };
        }),
      })),
    };

    return { tx, inserts, updates };
  }

  function makeService(tx: object): BankingSyncService {
    const database = { db: tx } as unknown as FinanceDatabaseService;
    return new BankingSyncService(database);
  }

  it('inserta cuentas nuevas con el tenantId de la conexión y mask por defecto 0000', async () => {
    const { tx, inserts } = createAccountsMock([]);
    const service = makeService(tx);

    const saved = await service.syncAccounts(makeConnection(), [
      makeAccount({ mask: null, rawMetadata: undefined }),
    ]);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      providerAccountId: 'p_acc_1',
      accountNumberMasked: '****0000',
      mask: null,
      currentBalanceMinor: 100000n,
      availableBalanceMinor: 90000n,
      rawMetadata: {},
      lastSyncedAt: expect.any(Date),
    });
    expect(saved[0].id).toBe('acc-new');
  });

  it('actualiza saldos y rawMetadata de cuentas existentes sin insertar', async () => {
    const { tx, inserts, updates } = createAccountsMock([{ id: 'acc-existing' }]);
    const service = makeService(tx);

    const saved = await service.syncAccounts(makeConnection(), [
      makeAccount({ balanceCurrentMinor: 500n, balanceAvailableMinor: null }),
    ]);

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      currentBalanceMinor: 500n,
      availableBalanceMinor: 500n,
      rawMetadata: { balances: { current: 1000 } },
      lastSyncedAt: expect.any(Date),
    });
    expect(saved[0].id).toBe('acc-existing');
  });

  it('usa userId como fallback cuando la conexión no tiene tenantId (comportamiento actual)', async () => {
    const { tx, inserts } = createAccountsMock([]);
    const service = makeService(tx);

    // La columna es NOT NULL en DB; simulamos un registro legado sin tenantId.
    const legacyConnection = makeConnection({ tenantId: null as unknown as string });

    await service.syncAccounts(legacyConnection, [makeAccount()]);

    // Documentado: el servicio propaga el tenantId de la conexión y cae a userId
    // cuando éste no está presente, evitando insertar tenantId nulo.
    expect(inserts[0].tenantId).toBe('user-1');
  });
});

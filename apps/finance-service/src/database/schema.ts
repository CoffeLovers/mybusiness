import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Los valores de estos enums se mantienen alineados con `@mybusiness/contracts`:
 * - AccountType: CHECKING, SAVINGS, CREDIT, INVESTMENT
 * - SyncStatus: SYNCED, PENDING, ERROR
 * - TransactionType: INCOME, EXPENSE, TRANSFER
 * - TransactionStatus: PENDING, SETTLED, CANCELLED, RECONCILED
 * - InvoiceStatus: DRAFT, ISSUED, PAID, OVERDUE, CANCELLED
 */
export const accountTypeEnum = pgEnum('account_type', [
  'CHECKING',
  'SAVINGS',
  'CREDIT',
  'INVESTMENT',
]);

export const syncStatusEnum = pgEnum('sync_status', ['SYNCED', 'PENDING', 'ERROR']);

export const transactionTypeEnum = pgEnum('transaction_type', ['INCOME', 'EXPENSE', 'TRANSFER']);

export const transactionStatusEnum = pgEnum('transaction_status', [
  'PENDING',
  'SETTLED',
  'CANCELLED',
  'RECONCILED',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'ISSUED',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);

/**
 * Tabla: bank_connections
 * Conexión unificada a agregadores bancarios (Plaid / Belvo).
 * Almacena credenciales de acceso cifradas (AES-256-GCM) sin exponerlas nunca en claro.
 */
export const bankConnections = pgTable(
  'bank_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id'),
    provider: varchar('provider', { length: 50 }).notNull(),
    providerItemId: varchar('provider_item_id', { length: 255 }).notNull(),
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    tokenKeyVersion: varchar('token_key_version', { length: 50 }).notNull().default('v1'),
    institutionId: varchar('institution_id', { length: 255 }),
    institutionName: varchar('institution_name', { length: 255 }),
    environment: varchar('environment', { length: 50 }).notNull().default('sandbox'),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    consentedProducts: jsonb('consented_products').$type<string[]>().notNull().default([]),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    rawMetadata: jsonb('raw_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('bank_connections_user_provider_status_idx').on(
      table.userId,
      table.provider,
      table.status,
    ),
    uniqueIndex('bank_connections_provider_env_item_uq').on(
      table.provider,
      table.environment,
      table.providerItemId,
    ),
  ],
);

/**
 * Tabla: bank_accounts
 * Representa cuentas bancarias del tenant y cuentas vinculadas vía agregadores (Plaid / Belvo).
 * Conforme a ADR-003, los saldos se manejan en unidades menores (BIGINT).
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').references(() => bankConnections.id, {
      onDelete: 'cascade',
    }),
    providerAccountId: varchar('provider_account_id', { length: 255 }),
    institutionName: varchar('institution_name', { length: 255 }).notNull(),
    institutionCode: varchar('institution_code', { length: 50 }),
    name: varchar('name', { length: 255 }),
    officialName: varchar('official_name', { length: 255 }),
    accountType: accountTypeEnum('account_type').notNull().default('CHECKING'),
    type: varchar('type', { length: 100 }),
    subtype: varchar('subtype', { length: 100 }),
    accountNumberMasked: varchar('account_number_masked', { length: 50 }).notNull(),
    mask: varchar('mask', { length: 50 }),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    isoCurrencyCode: varchar('iso_currency_code', { length: 3 }),
    currentBalanceMinor: bigint('current_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    availableBalanceMinor: bigint('available_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    balanceCurrent: bigint('balance_current', { mode: 'bigint' }),
    balanceAvailable: bigint('balance_available', { mode: 'bigint' }),
    syncStatus: syncStatusEnum('sync_status').notNull().default('SYNCED'),
    status: varchar('status', { length: 50 }).default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    rawMetadata: jsonb('raw_metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('bank_accounts_tenant_id_idx').on(table.tenantId),
    index('bank_accounts_tenant_account_idx').on(table.tenantId, table.accountNumberMasked),
    index('bank_accounts_deleted_at_idx').on(table.deletedAt),
    uniqueIndex('bank_accounts_connection_provider_account_uq').on(
      table.connectionId,
      table.providerAccountId,
    ),
    index('bank_accounts_connection_id_idx').on(table.connectionId),
  ],
);

/**
 * Tabla: bank_transaction_sync_state
 * Cursor de sincronización y estado para cada conexión agregadora (Plaid / Belvo).
 */
export const bankTransactionSyncState = pgTable('bank_transaction_sync_state', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => bankConnections.id, { onDelete: 'cascade' }),
  cursor: text('cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncOffset: bigint('sync_offset', { mode: 'bigint' }).default(sql`0`),
  initialSyncComplete: boolean('initial_sync_complete').notNull().default(false),
  lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
  lastSyncStartedAt: timestamp('last_sync_started_at', { withTimezone: true }),
  lastSyncCompletedAt: timestamp('last_sync_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Tabla: bank_transactions
 * Transacciones descargadas desde agregadores bancarios (Plaid / Belvo).
 * Idempotencia garantizada por UNIQUE(account_id, provider_transaction_id).
 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => bankConnections.id, {
      onDelete: 'cascade',
    }),
    providerTransactionId: varchar('provider_transaction_id', { length: 255 }).notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    isoCurrencyCode: varchar('iso_currency_code', { length: 3 }).notNull().default('USD'),
    date: varchar('date', { length: 50 }).notNull(),
    authorizedDate: varchar('authorized_date', { length: 50 }),
    name: varchar('name', { length: 500 }).notNull(),
    merchantName: varchar('merchant_name', { length: 255 }),
    category: jsonb('category').$type<string[]>().default([]),
    pending: boolean('pending').notNull().default(false),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    rawMetadata: jsonb('raw_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('bank_transactions_account_provider_tx_uq').on(
      table.accountId,
      table.providerTransactionId,
    ),
    index('bank_transactions_account_id_idx').on(table.accountId),
    index('bank_transactions_connection_id_idx').on(table.connectionId),
    index('bank_transactions_date_idx').on(table.date),
  ],
);

/**
 * Tabla: bank_webhook_events
 * Registro idempotente de eventos webhook recibidos de proveedores bancarios.
 */
export const bankWebhookEvents = pgTable(
  'bank_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    providerEventKey: varchar('provider_event_key', { length: 255 }).notNull(),
    webhookType: varchar('webhook_type', { length: 100 }).notNull(),
    webhookCode: varchar('webhook_code', { length: 100 }),
    connectionId: uuid('connection_id').references(() => bankConnections.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    processingStatus: varchar('processing_status', { length: 50 }).notNull().default('pending'),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('bank_webhook_events_provider_event_key_uq').on(
      table.provider,
      table.providerEventKey,
    ),
    index('bank_webhook_events_connection_id_idx').on(table.connectionId),
    index('bank_webhook_events_processing_status_idx').on(table.processingStatus),
  ],
);

/**
 * Tabla: transactions
 * Transacciones financieras asociadas a una cuenta bancaria.
 * Garantiza idempotencia a nivel de base de datos con UNIQUE (tenantId, idempotencyKey).
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    type: transactionTypeEnum('type').notNull(),
    status: transactionStatusEnum('status').notNull().default('PENDING'),
    bookingDate: timestamp('booking_date', { withTimezone: true }).notNull().defaultNow(),
    description: varchar('description', { length: 500 }).notNull(),
    category: varchar('category', { length: 100 }),
    counterparty: jsonb('counterparty').$type<Record<string, unknown>>().default({}),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('transactions_tenant_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    index('transactions_tenant_id_idx').on(table.tenantId),
    index('transactions_bank_account_id_idx').on(table.bankAccountId),
    index('transactions_tenant_booking_date_idx').on(table.tenantId, table.bookingDate),
    index('transactions_status_idx').on(table.status),
  ],
);

/**
 * Tabla: invoices
 * Facturas emitidas o recibidas (cuentas por cobrar / pagar).
 * Subtotal, impuestos y totales en unidades menores (BIGINT) según ADR-003.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    counterpartyName: varchar('counterparty_name', { length: 255 }).notNull(),
    counterpartyTaxId: varchar('counterparty_tax_id', { length: 50 }).notNull(),
    issueDate: timestamp('issue_date', { withTimezone: true }).notNull().defaultNow(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    taxAmountMinor: bigint('tax_amount_minor', { mode: 'bigint' }).notNull(),
    totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    status: invoiceStatusEnum('status').notNull().default('DRAFT'),
    lineItems: jsonb('line_items')
      .$type<
        Array<{
          description: string;
          quantity: number;
          unitPriceMinor: string;
          subtotalMinor: string;
          taxRateBps: number;
          taxAmountMinor: string;
          totalMinor: string;
        }>
      >()
      .notNull()
      .default([]),
    associatedTransactionId: uuid('associated_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('invoices_tenant_number_uq').on(table.tenantId, table.invoiceNumber),
    index('invoices_tenant_id_idx').on(table.tenantId),
    index('invoices_status_idx').on(table.status),
    index('invoices_due_date_idx').on(table.dueDate),
    index('invoices_deleted_at_idx').on(table.deletedAt),
  ],
);

export const bankConnectionsRelations = relations(bankConnections, ({ many, one }) => ({
  accounts: many(bankAccounts),
  syncState: one(bankTransactionSyncState, {
    fields: [bankConnections.id],
    references: [bankTransactionSyncState.connectionId],
  }),
  transactions: many(bankTransactions),
  webhookEvents: many(bankWebhookEvents),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  connection: one(bankConnections, {
    fields: [bankAccounts.connectionId],
    references: [bankConnections.id],
  }),
  transactions: many(transactions),
  bankTransactions: many(bankTransactions),
}));

export const bankTransactionSyncStateRelations = relations(bankTransactionSyncState, ({ one }) => ({
  connection: one(bankConnections, {
    fields: [bankTransactionSyncState.connectionId],
    references: [bankConnections.id],
  }),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  account: one(bankAccounts, {
    fields: [bankTransactions.accountId],
    references: [bankAccounts.id],
  }),
  connection: one(bankConnections, {
    fields: [bankTransactions.connectionId],
    references: [bankConnections.id],
  }),
}));

export const bankWebhookEventsRelations = relations(bankWebhookEvents, ({ one }) => ({
  connection: one(bankConnections, {
    fields: [bankWebhookEvents.connectionId],
    references: [bankConnections.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  bankAccount: one(bankAccounts, {
    fields: [transactions.bankAccountId],
    references: [bankAccounts.id],
  }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  associatedTransaction: one(transactions, {
    fields: [invoices.associatedTransactionId],
    references: [transactions.id],
  }),
}));

export type BankConnection = typeof bankConnections.$inferSelect;
export type NewBankConnection = typeof bankConnections.$inferInsert;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
export type BankTransactionSyncState = typeof bankTransactionSyncState.$inferSelect;
export type NewBankTransactionSyncState = typeof bankTransactionSyncState.$inferInsert;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;
export type BankWebhookEvent = typeof bankWebhookEvents.$inferSelect;
export type NewBankWebhookEvent = typeof bankWebhookEvents.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

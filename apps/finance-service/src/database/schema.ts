import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
 * Alineado con `DocumentStatus` de `@mybusiness/contracts`.
 */
export const documentStatusEnum = pgEnum('document_status', [
  'PENDING',
  'PROCESSING',
  'EXTRACTED',
  'NEEDS_REVIEW',
  'FAILED',
]);

/**
 * Estados de coincidencia de conciliación bancaria.
 */
export const reconciliationMatchStatusEnum = pgEnum('reconciliation_match_status', [
  'AUTO_MATCHED',
  'NEEDS_REVIEW',
  'MANUAL_MATCHED',
  'REJECTED',
]);

/**
 * Estados de ejecución del motor de conciliación.
 */
export const reconciliationRunStatusEnum = pgEnum('reconciliation_run_status', [
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

/**
 * Disparador de la ejecución de conciliación.
 */
export const reconciliationTriggerEnum = pgEnum('reconciliation_trigger', ['MANUAL', 'NIGHTLY']);

/**
 * Estados de una orden PayPal, alineados con `PayPalOrderStatus` de
 * `@mybusiness/contracts` (ADR 003/004).
 */
export const paypalOrderStatusEnum = pgEnum('paypal_order_status', [
  'CREATED',
  'APPROVED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
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
    tenantId: uuid('tenant_id').notNull(),
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
    index('bank_connections_tenant_user_idx').on(table.tenantId, table.userId),
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
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
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
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    transactionType: transactionTypeEnum('transaction_type').notNull(),
    isoCurrencyCode: varchar('iso_currency_code', { length: 3 }).notNull().default('USD'),
    date: varchar('date', { length: 50 }).notNull(),
    authorizedDate: varchar('authorized_date', { length: 50 }),
    name: varchar('name', { length: 500 }).notNull(),
    merchantName: varchar('merchant_name', { length: 255 }),
    category: jsonb('category').$type<string[]>().default([]),
    notes: text('notes'),
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
    index('bank_transactions_account_date_idx').on(table.accountId, table.date),
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
    processingStatus: varchar('processing_status', { length: 50 }).notNull().default('received'),
    errorMessage: text('error_message'),
    /** Momento en que ocurrió el evento según el proveedor; base para la guardia de orden. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    /** Intentos de procesamiento observados por el worker (informativo). */
    attempts: integer('attempts').notNull().default(0),
    /** Veces que un operador solicitó replay manual del evento. */
    replayCount: integer('replay_count').notNull().default(0),
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
    index('bank_webhook_events_connection_occurred_idx').on(table.connectionId, table.occurredAt),
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
 * Tabla: documents
 * Documentos subidos (facturas, recibos) y el resultado de su extracción OCR.
 * Idempotencia por tenant garantizada con UNIQUE(tenant_id, checksum_sha256).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    status: documentStatusEnum('status').notNull().default('PENDING'),
    ocrProvider: varchar('ocr_provider', { length: 50 }),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    providerName: varchar('provider_name', { length: 255 }),
    taxId: varchar('tax_id', { length: 50 }),
    invoiceNumber: varchar('invoice_number', { length: 100 }),
    issueDate: date('issue_date'),
    currency: varchar('currency', { length: 3 }),
    totalMinor: bigint('total_minor', { mode: 'bigint' }),
    lineItems: jsonb('line_items')
      .$type<
        Array<{
          description: string;
          quantity: number;
          unitPriceMinor: string;
          taxRateBps: number;
          totalMinor: string;
        }>
      >()
      .notNull()
      .default([]),
    failureReason: text('failure_reason'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('documents_tenant_status_idx').on(table.tenantId, table.status),
    uniqueIndex('documents_tenant_checksum_uq').on(table.tenantId, table.checksumSha256),
    index('documents_tenant_created_at_idx').on(table.tenantId, table.createdAt),
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
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
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
    index('invoices_document_id_idx').on(table.documentId),
  ],
);

/**
 * Tabla: reconciliation_settings
 * Configuración del motor de conciliación y del cron nocturno por tenant.
 */
export const reconciliationSettings = pgTable('reconciliation_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  dateWindowDays: integer('date_window_days').notNull().default(5),
  autoMatchThresholdBps: integer('auto_match_threshold_bps').notNull().default(8500),
  timezone: varchar('timezone', { length: 100 }).notNull().default('America/Bogota'),
  lookbackDays: integer('lookback_days').notNull().default(30),
  nightlyEnabled: boolean('nightly_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Tabla: reconciliation_matches
 * Coincidencias entre movimientos bancarios (bank_transactions) y documentos (documents).
 */
export const reconciliationMatches = pgTable(
  'reconciliation_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    bankTransactionId: uuid('bank_transaction_id')
      .notNull()
      .references(() => bankTransactions.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    status: reconciliationMatchStatusEnum('status').notNull().default('NEEDS_REVIEW'),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    rule: varchar('rule', { length: 100 }).notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    matchedBy: uuid('matched_by'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('reconciliation_matches_tenant_tx_doc_uq').on(
      table.tenantId,
      table.bankTransactionId,
      table.documentId,
    ),
    uniqueIndex('reconciliation_matches_active_tx_uq')
      .on(table.tenantId, table.bankTransactionId)
      .where(sql`status IN ('AUTO_MATCHED', 'MANUAL_MATCHED')`),
    uniqueIndex('reconciliation_matches_active_doc_uq')
      .on(table.tenantId, table.documentId)
      .where(sql`status IN ('AUTO_MATCHED', 'MANUAL_MATCHED')`),
    index('reconciliation_matches_tenant_status_idx').on(table.tenantId, table.status),
    index('reconciliation_matches_bank_tx_idx').on(table.bankTransactionId),
    index('reconciliation_matches_doc_idx').on(table.documentId),
  ],
);

/**
 * Tabla: reconciliation_runs
 * Registro histórico y auditoría de ejecuciones de conciliación por tenant.
 */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    trigger: reconciliationTriggerEnum('trigger').notNull().default('MANUAL'),
    status: reconciliationRunStatusEnum('status').notNull().default('RUNNING'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    processed: integer('processed').notNull().default(0),
    autoMatched: integer('auto_matched').notNull().default(0),
    needsReview: integer('needs_review').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reconciliation_runs_tenant_idx').on(table.tenantId, table.createdAt)],
);

/**
 * Tabla: ledger_saved_views
 * Vistas guardadas del libro mayor por usuario y tenant.
 */
export const ledgerSavedViews = pgTable(
  'ledger_saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    query: jsonb('query').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('ledger_saved_views_tenant_user_name_uq').on(
      table.tenantId,
      table.userId,
      table.name,
    ),
    index('ledger_saved_views_tenant_user_idx').on(table.tenantId, table.userId),
  ],
);

/**
 * Tabla: paypal_orders
 * Órdenes PayPal asociadas a facturas del libro mayor (SF3-08).
 * Importe en unidad mínima BIGINT (ADR 003); idempotencia garantizada por la
 * base de datos con UNIQUE (tenant_id, idempotency_key) devolviendo la
 * respuesta original del proveedor en `provider_response`.
 */
export const paypalOrders = pgTable(
  'paypal_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    status: paypalOrderStatusEnum('status').notNull().default('CREATED'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    paypalOrderId: varchar('paypal_order_id', { length: 255 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    checkoutUrl: text('checkout_url').notNull(),
    /** Respuesta cruda del proveedor, base del replay idempotente y de SF3-09. */
    providerResponse: jsonb('provider_response')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('paypal_orders_tenant_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    uniqueIndex('paypal_orders_paypal_order_id_uq').on(table.paypalOrderId),
    index('paypal_orders_tenant_id_idx').on(table.tenantId),
    index('paypal_orders_invoice_id_idx').on(table.invoiceId),
    index('paypal_orders_tenant_created_at_idx').on(table.tenantId, table.createdAt),
  ],
);

export const paypalOrdersRelations = relations(paypalOrders, ({ one }) => ({
  invoice: one(invoices, {
    fields: [paypalOrders.invoiceId],
    references: [invoices.id],
  }),
}));

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

export const documentsRelations = relations(documents, ({ many }) => ({
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  associatedTransaction: one(transactions, {
    fields: [invoices.associatedTransactionId],
    references: [transactions.id],
  }),
  document: one(documents, {
    fields: [invoices.documentId],
    references: [documents.id],
  }),
}));

export const reconciliationMatchesRelations = relations(reconciliationMatches, ({ one }) => ({
  bankTransaction: one(bankTransactions, {
    fields: [reconciliationMatches.bankTransactionId],
    references: [bankTransactions.id],
  }),
  document: one(documents, {
    fields: [reconciliationMatches.documentId],
    references: [documents.id],
  }),
  invoice: one(invoices, {
    fields: [reconciliationMatches.invoiceId],
    references: [invoices.id],
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
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ReconciliationSettings = typeof reconciliationSettings.$inferSelect;
export type NewReconciliationSettings = typeof reconciliationSettings.$inferInsert;
export type ReconciliationMatch = typeof reconciliationMatches.$inferSelect;
export type NewReconciliationMatch = typeof reconciliationMatches.$inferInsert;
export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
export type NewReconciliationRun = typeof reconciliationRuns.$inferInsert;
export type LedgerSavedView = typeof ledgerSavedViews.$inferSelect;
export type NewLedgerSavedView = typeof ledgerSavedViews.$inferInsert;
export type PayPalOrder = typeof paypalOrders.$inferSelect;
export type NewPayPalOrder = typeof paypalOrders.$inferInsert;

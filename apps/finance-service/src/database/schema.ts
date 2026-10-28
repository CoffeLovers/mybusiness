import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
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
 * Tabla: bank_accounts
 * Representa cuentas bancarias del tenant.
 * Conforme a ADR-003, los saldos se manejan en unidades menores (BIGINT).
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    institutionName: varchar('institution_name', { length: 255 }).notNull(),
    institutionCode: varchar('institution_code', { length: 50 }),
    accountType: accountTypeEnum('account_type').notNull().default('CHECKING'),
    accountNumberMasked: varchar('account_number_masked', { length: 50 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    currentBalanceMinor: bigint('current_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    availableBalanceMinor: bigint('available_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    syncStatus: syncStatusEnum('sync_status').notNull().default('SYNCED'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
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

export const bankAccountsRelations = relations(bankAccounts, ({ many }) => ({
  transactions: many(transactions),
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

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

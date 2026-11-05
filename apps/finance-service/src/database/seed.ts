import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// El `.env` vive en la raíz del monorepo; el script se ejecuta desde apps/finance-service.
config({ path: resolve(__dirname, '../../../../.env') });
config();

import {
  AccountType,
  InvoiceStatus,
  SyncStatus,
  TransactionStatus,
  TransactionType,
} from '@mybusiness/contracts';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client';
import { bankAccounts, invoices, transactions } from './schema';

function getEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

async function seed(): Promise<void> {
  const defaultTenantId = getEnvOrDefault(
    'SEED_FINANCE_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );
  const currency = getEnvOrDefault('SEED_TENANT_CURRENCY', 'COP');

  const { db, pool } = createDatabase();

  try {
    // 1. Cuenta Bancaria Demo
    let [bankAccount] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.tenantId, defaultTenantId))
      .limit(1);

    if (!bankAccount) {
      const [inserted] = await db
        .insert(bankAccounts)
        .values({
          tenantId: defaultTenantId,
          institutionName: 'Bancolombia Demo',
          institutionCode: 'BANCOLOMBIA',
          accountType: AccountType.CHECKING,
          accountNumberMasked: '******1234',
          currency,
          currentBalanceMinor: 1500000000n, // $15,000,000.00 COP
          availableBalanceMinor: 1500000000n,
          syncStatus: SyncStatus.SYNCED,
          metadata: { demo: true, branch: 'Medellín Centro' },
        })
        .returning();
      bankAccount = inserted;
    }

    // 2. Transacción Demo (con idempotencyKey determinista)
    const idempotencyKey = `seed-txn-${defaultTenantId}-001`;
    const [existingTxn] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey))
      .limit(1);

    let txnId = existingTxn?.id;
    if (!existingTxn && bankAccount) {
      const [insertedTxn] = await db
        .insert(transactions)
        .values({
          tenantId: defaultTenantId,
          bankAccountId: bankAccount.id,
          amountMinor: 250000000n, // $2,500,000.00 COP
          currency,
          type: TransactionType.INCOME,
          status: TransactionStatus.SETTLED,
          description: 'Pago de consultoría financiera inicial (Seed)',
          category: 'Servicios Profesionales',
          counterparty: { name: 'Cliente Ejemplo S.A.S.', taxId: '901234567-8' },
          idempotencyKey,
        })
        .returning();
      txnId = insertedTxn.id;
    }

    // 3. Factura Demo
    const invoiceNumber = 'FAC-DEMO-0001';
    const [existingInvoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNumber))
      .limit(1);

    if (!existingInvoice) {
      await db.insert(invoices).values({
        tenantId: defaultTenantId,
        invoiceNumber,
        counterpartyName: 'Cliente Ejemplo S.A.S.',
        counterpartyTaxId: '901234567-8',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotalMinor: 210084034n, // $2,100,840.34
        taxAmountMinor: 39915966n, // 19% IVA = $399,159.66
        totalAmountMinor: 250000000n, // $2,500,000.00
        currency,
        status: InvoiceStatus.PAID,
        lineItems: [
          {
            description: 'Servicio de consultoría contable',
            quantity: 1,
            unitPriceMinor: '210084034',
            subtotalMinor: '210084034',
            taxRateBps: 1900,
            taxAmountMinor: '39915966',
            totalMinor: '250000000',
          },
        ],
        associatedTransactionId: txnId,
      });
    }

    console.log('Seed de finance-service completado:', {
      tenantId: defaultTenantId,
      bankAccountId: bankAccount?.id,
    });
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Error ejecutando seed de finance-service:', error);
  process.exitCode = 1;
});

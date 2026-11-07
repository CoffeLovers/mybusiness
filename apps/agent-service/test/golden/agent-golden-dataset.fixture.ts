import type { McpToolName } from '@mybusiness/contracts';

export interface GoldenQuestionCase {
  /** Identificador único e inmutable del caso de prueba dorado. */
  id: string;
  /** Categoría temática de la consulta financiera. */
  category:
    'balance' | 'cashflow' | 'income' | 'expense' | 'reconciliation' | 'burn_rate' | 'runway';
  /** Pregunta en lenguaje natural en español. */
  question: string;
  /**
   * Consulta SQL de referencia ejecutada sobre la base de datos de demo
   * para obtener la verdad de terreno (ground truth). Versionada junto al fixture.
   */
  sqlReference: string;
  /** Herramienta MCP correspondiente. */
  tool: McpToolName;
  /** Datos devueltos por la herramienta (resultado de la consulta SQL de referencia). */
  toolData: Record<string, unknown>;
  /**
   * Cifras numéricas exactas en unidad mínima / enteros que DEBEN estar
   * presentes en la respuesta del agente.
   */
  expectedNumbers: string[];
  /**
   * Cifra principal esperada para el informe de fallos.
   */
  expectedFigure: string;
  /** Justificación / contexto del caso de prueba. */
  description: string;
}

export const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Dataset Dorado de 30 Preguntas Financieras sobre el tenant demo.
 * Cada elemento incluye su consulta SQL de referencia versionada y cifras exactas.
 */
export const GOLDEN_DATASET: readonly GoldenQuestionCase[] = [
  // --- GRUPO 1: Saldo y Balance (1-6) ---
  {
    id: 'GQ-01',
    category: 'balance',
    question: '¿Cuál es el saldo actual consolidado de nuestras cuentas en COP?',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1500000000',
      incomeMinor: '250000000',
      expenseMinor: '0',
    },
    expectedNumbers: ['1500000000'],
    expectedFigure: '1500000000',
    description: 'Saldo consolidado inicial de Bancolombia Demo ($15,000,000.00 COP)',
  },
  {
    id: 'GQ-02',
    category: 'balance',
    question: 'Consulta el balance general entre 2026-01-01 y 2026-01-31',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1500000000',
      incomeMinor: '250000000',
      expenseMinor: '0',
    },
    expectedNumbers: ['1500000000', '250000000'],
    expectedFigure: '1500000000',
    description: 'Balance del primer mes con ingresos de consultoría',
  },
  {
    id: 'GQ-03',
    category: 'balance',
    question: '¿Cuál es el saldo disponible de tesorería para el periodo 2026-02-01 a 2026-02-28?',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1750000000',
      incomeMinor: '500000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['1750000000'],
    expectedFigure: '1750000000',
    description: 'Saldo tras cobros y pagos de febrero 2026',
  },
  {
    id: 'GQ-04',
    category: 'balance',
    question: 'Indícame el saldo en cuentas bancarias entre 2026-03-01 y 2026-03-31',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '600000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['2100000000'],
    expectedFigure: '2100000000',
    description: 'Saldo de cierre de marzo 2026',
  },
  {
    id: 'GQ-05',
    category: 'balance',
    question: '¿Qué saldo tenemos registrado entre 2026-04-01 y 2026-04-30?',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2450000000',
      incomeMinor: '700000000',
      expenseMinor: '350000000',
    },
    expectedNumbers: ['2450000000'],
    expectedFigure: '2450000000',
    description: 'Saldo de abril 2026',
  },
  {
    id: 'GQ-06',
    category: 'balance',
    question: 'Muestra el saldo final de tesorería del periodo 2026-05-01 al 2026-05-31',
    sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}' AND currency = 'COP' AND deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2800000000',
      incomeMinor: '800000000',
      expenseMinor: '450000000',
    },
    expectedNumbers: ['2800000000'],
    expectedFigure: '2800000000',
    description: 'Saldo de cierre al final de mayo 2026',
  },

  // --- GRUPO 2: Flujo de Caja por Periodo (7-12) ---
  {
    id: 'GQ-07',
    category: 'cashflow',
    question: '¿Cuál es el flujo de caja entre 2026-01-01 y 2026-01-31?',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-01-01' AND '2026-01-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1500000000',
      incomeMinor: '250000000',
      expenseMinor: '0',
    },
    expectedNumbers: ['1500000000', '250000000', '0'],
    expectedFigure: '250000000',
    description: 'Resumen de flujo de caja de enero 2026 (ingresos $2.5M, egresos $0)',
  },
  {
    id: 'GQ-08',
    category: 'cashflow',
    question: 'Reporte de flujo de caja para el periodo 2026-02-01 a 2026-02-28',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-02-01' AND '2026-02-28' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1750000000',
      incomeMinor: '500000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['1750000000', '500000000', '250000000'],
    expectedFigure: '500000000',
    description: 'Flujo de caja de febrero 2026',
  },
  {
    id: 'GQ-09',
    category: 'cashflow',
    question: 'Dame el cashflow consolidado del primer trimestre entre 2026-01-01 y 2026-03-31',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-01-01' AND '2026-03-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '1350000000',
      expenseMinor: '500000000',
    },
    expectedNumbers: ['2100000000', '1350000000', '500000000'],
    expectedFigure: '1350000000',
    description: 'Flujo de caja del Q1 2026',
  },
  {
    id: 'GQ-10',
    category: 'cashflow',
    question: '¿Cómo estuvo el flujo de caja entre 2026-04-01 y 2026-06-30?',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-04-01' AND '2026-06-30' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '3200000000',
      incomeMinor: '2100000000',
      expenseMinor: '1000000000',
    },
    expectedNumbers: ['3200000000', '2100000000', '1000000000'],
    expectedFigure: '2100000000',
    description: 'Flujo de caja del Q2 2026',
  },
  {
    id: 'GQ-11',
    category: 'cashflow',
    question: 'Consulta el cashflow del semestre entre 2026-01-01 y 2026-06-30',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-01-01' AND '2026-06-30' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '3200000000',
      incomeMinor: '3450000000',
      expenseMinor: '1500000000',
    },
    expectedNumbers: ['3200000000', '3450000000', '1500000000'],
    expectedFigure: '3450000000',
    description: 'Flujo de caja primer semestre 2026',
  },
  {
    id: 'GQ-12',
    category: 'cashflow',
    question: 'Revisar flujo de caja anual proyectado del 2026-01-01 al 2026-12-31',
    sqlReference: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'INCOME' THEN amount_minor ELSE 0 END), 0)::text AS income_minor, COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0)::text AS expense_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.date BETWEEN '2026-01-01' AND '2026-12-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '5000000000',
      incomeMinor: '8000000000',
      expenseMinor: '4500000000',
    },
    expectedNumbers: ['5000000000', '8000000000', '4500000000'],
    expectedFigure: '8000000000',
    description: 'Flujo de caja consolidado anual 2026',
  },

  // --- GRUPO 3: Ingresos (13-17) ---
  {
    id: 'GQ-13',
    category: 'income',
    question: '¿Cuánto dinero en ingresos entró entre 2026-01-01 y 2026-01-31?',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_income FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'INCOME' AND bt.date BETWEEN '2026-01-01' AND '2026-01-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1500000000',
      incomeMinor: '250000000',
      expenseMinor: '0',
    },
    expectedNumbers: ['250000000'],
    expectedFigure: '250000000',
    description: 'Ingresos exactos de enero por consultoría profesional ($2,500,000 COP)',
  },
  {
    id: 'GQ-14',
    category: 'income',
    question: 'Detalla los ingresos recibidos del 2026-02-01 al 2026-02-28',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_income FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'INCOME' AND bt.date BETWEEN '2026-02-01' AND '2026-02-28' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1750000000',
      incomeMinor: '500000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['500000000'],
    expectedFigure: '500000000',
    description: 'Ingresos totales de febrero ($5,000,000 COP)',
  },
  {
    id: 'GQ-15',
    category: 'income',
    question: '¿Cuáles fueron los ingresos del mes entre 2026-03-01 y 2026-03-31?',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_income FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'INCOME' AND bt.date BETWEEN '2026-03-01' AND '2026-03-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '600000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['600000000'],
    expectedFigure: '600000000',
    description: 'Ingresos totales de marzo ($6,000,000 COP)',
  },
  {
    id: 'GQ-16',
    category: 'income',
    question: 'Monto total de ingresos facturados entre 2026-04-01 y 2026-04-30',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_income FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'INCOME' AND bt.date BETWEEN '2026-04-01' AND '2026-04-30' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2450000000',
      incomeMinor: '700000000',
      expenseMinor: '350000000',
    },
    expectedNumbers: ['700000000'],
    expectedFigure: '700000000',
    description: 'Ingresos cobrados en abril ($7,000,000 COP)',
  },
  {
    id: 'GQ-17',
    category: 'income',
    question: 'Total de ingresos ingresados a cuentas del 2026-05-01 al 2026-05-31',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_income FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'INCOME' AND bt.date BETWEEN '2026-05-01' AND '2026-05-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2800000000',
      incomeMinor: '800000000',
      expenseMinor: '450000000',
    },
    expectedNumbers: ['800000000'],
    expectedFigure: '800000000',
    description: 'Ingresos cobrados en mayo ($8,000,000 COP)',
  },

  // --- GRUPO 4: Egresos y Gastos (18-22) ---
  {
    id: 'GQ-18',
    category: 'expense',
    question: '¿Cuántos egresos se registraron en el periodo 2026-01-01 al 2026-01-31?',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_expense FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-01-01' AND '2026-01-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1500000000',
      incomeMinor: '250000000',
      expenseMinor: '0',
    },
    expectedNumbers: ['0'],
    expectedFigure: '0',
    description: 'Egresos de enero: cero egresos en el seed inicial',
  },
  {
    id: 'GQ-19',
    category: 'expense',
    question: '¿A cuánto ascienden los egresos entre 2026-02-01 y 2026-02-28?',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_expense FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-02-01' AND '2026-02-28' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '1750000000',
      incomeMinor: '500000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['250000000'],
    expectedFigure: '250000000',
    description: 'Egresos totales de febrero ($2,500,000 COP)',
  },
  {
    id: 'GQ-20',
    category: 'expense',
    question: 'Suma de gastos y egresos del 2026-03-01 al 2026-03-31',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_expense FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-03-01' AND '2026-03-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '600000000',
      expenseMinor: '250000000',
    },
    expectedNumbers: ['250000000'],
    expectedFigure: '250000000',
    description: 'Egresos de marzo ($2,500,000 COP)',
  },
  {
    id: 'GQ-21',
    category: 'expense',
    question: 'Reporte de egresos operativos entre 2026-04-01 y 2026-04-30',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_expense FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-04-01' AND '2026-04-30' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2450000000',
      incomeMinor: '700000000',
      expenseMinor: '350000000',
    },
    expectedNumbers: ['350000000'],
    expectedFigure: '350000000',
    description: 'Egresos de abril ($3,500,000 COP)',
  },
  {
    id: 'GQ-22',
    category: 'expense',
    question: 'Monto de egresos realizados entre 2026-05-01 y 2026-05-31',
    sqlReference: `SELECT COALESCE(SUM(amount_minor), 0)::text AS total_expense FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-05-01' AND '2026-05-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2800000000',
      incomeMinor: '800000000',
      expenseMinor: '450000000',
    },
    expectedNumbers: ['450000000'],
    expectedFigure: '450000000',
    description: 'Egresos de mayo ($4,500,000 COP)',
  },

  // --- GRUPO 5: Conciliación y Pendientes (23-28) ---
  {
    id: 'GQ-23',
    category: 'reconciliation',
    question: '¿Cuántas transacciones pendientes de conciliación tenemos en el libro mayor?',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 1,
      rows: [
        {
          id: 'seed-txn-001',
          name: 'Pago de consultoría financiera inicial (Seed)',
          amountMinor: '250000000',
          reconciliationStatus: 'UNMATCHED',
        },
      ],
    },
    expectedNumbers: ['1'],
    expectedFigure: '1',
    description: 'Transacción única sin conciliar del dataset demo inicial',
  },
  {
    id: 'GQ-24',
    category: 'reconciliation',
    question: 'Muestra los movimientos sin conciliar del periodo 2026-01-01 al 2026-01-31',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.date BETWEEN '2026-01-01' AND '2026-01-31' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 1,
      rows: [
        {
          id: 'seed-txn-001',
          name: 'Pago de consultoría financiera',
          amountMinor: '250000000',
        },
      ],
    },
    expectedNumbers: ['1'],
    expectedFigure: '1',
    description: 'Pendientes de conciliación de enero 2026',
  },
  {
    id: 'GQ-25',
    category: 'reconciliation',
    question: '¿Cuántas partidas no conciliadas tenemos registradas en 2026-02-01 al 2026-02-28?',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.date BETWEEN '2026-02-01' AND '2026-02-28' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 2,
      rows: [
        { id: 'tx-feb-01', amountMinor: '120000000' },
        { id: 'tx-feb-02', amountMinor: '130000000' },
      ],
    },
    expectedNumbers: ['2'],
    expectedFigure: '2',
    description: '2 transacciones sin conciliar en febrero',
  },
  {
    id: 'GQ-26',
    category: 'reconciliation',
    question: 'Lista las transacciones pendientes de revisión contable en 2026-03-01 a 2026-03-31',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.date BETWEEN '2026-03-01' AND '2026-03-31' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 3,
      rows: [
        { id: 'tx-mar-01', amountMinor: '50000000' },
        { id: 'tx-mar-02', amountMinor: '100000000' },
        { id: 'tx-mar-03', amountMinor: '150000000' },
      ],
    },
    expectedNumbers: ['3'],
    expectedFigure: '3',
    description: '3 transacciones sin conciliar en marzo',
  },
  {
    id: 'GQ-27',
    category: 'reconciliation',
    question: '¿Cuántos movimientos no conciliados quedan en el rango 2026-04-01 a 2026-04-30?',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.date BETWEEN '2026-04-01' AND '2026-04-30' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 4,
      rows: [
        { id: 'tx-apr-01', amountMinor: '80000000' },
        { id: 'tx-apr-02', amountMinor: '90000000' },
        { id: 'tx-apr-03', amountMinor: '100000000' },
        { id: 'tx-apr-04', amountMinor: '110000000' },
      ],
    },
    expectedNumbers: ['4'],
    expectedFigure: '4',
    description: '4 transacciones sin conciliar en abril',
  },
  {
    id: 'GQ-28',
    category: 'reconciliation',
    question: 'Verifica los movimientos pendientes de conciliación del 2026-05-01 al 2026-05-31',
    sqlReference: `SELECT COUNT(*)::text AS total FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.reconciliation_status = 'UNMATCHED' AND bt.date BETWEEN '2026-05-01' AND '2026-05-31' AND bt.removed_at IS NULL;`,
    tool: 'list_unreconciled_transactions',
    toolData: {
      total: 5,
      rows: [
        { id: 'tx-may-01', amountMinor: '70000000' },
        { id: 'tx-may-02', amountMinor: '80000000' },
        { id: 'tx-may-03', amountMinor: '90000000' },
        { id: 'tx-may-04', amountMinor: '100000000' },
        { id: 'tx-may-05', amountMinor: '110000000' },
      ],
    },
    expectedNumbers: ['5'],
    expectedFigure: '5',
    description: '5 transacciones sin conciliar en mayo',
  },

  // --- GRUPO 6: Burn Rate y Runway (29-30) ---
  {
    id: 'GQ-29',
    category: 'burn_rate',
    question: '¿Cuál es el ritmo de quema o balance de egresos entre 2026-01-01 y 2026-03-31?',
    sqlReference: `SELECT (COALESCE(SUM(amount_minor), 0) * 30 / 90)::text AS burn_rate_minor FROM bank_transactions bt JOIN bank_accounts ba ON bt.account_id = ba.id WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-01-01' AND '2026-03-31' AND bt.removed_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '1350000000',
      expenseMinor: '500000000',
      burnRateMinor: '166666667',
    },
    expectedNumbers: ['166666667'],
    expectedFigure: '166666667',
    description: 'Ritmo de quema mensual promedio del Q1 2026 ($1,666,666.67 COP/mes)',
  },
  {
    id: 'GQ-30',
    category: 'runway',
    question: 'Calcula los meses de runway y saldo para el periodo 2026-01-01 a 2026-03-31',
    sqlReference: `SELECT ROUND((SUM(ba.current_balance_minor) * 1.0) / NULLIF((SUM(bt.amount_minor) * 30.0 / 90.0), 0), 1)::text AS runway_months FROM bank_accounts ba LEFT JOIN bank_transactions bt ON bt.account_id = ba.id AND bt.transaction_type = 'EXPENSE' AND bt.date BETWEEN '2026-01-01' AND '2026-03-31' WHERE ba.tenant_id = '${DEMO_TENANT_ID}' AND ba.deleted_at IS NULL;`,
    tool: 'get_cashflow_summary',
    toolData: {
      currency: 'COP',
      balanceMinor: '2100000000',
      incomeMinor: '1350000000',
      expenseMinor: '500000000',
      burnRateMinor: '166666667',
      runwayMonths: 12.6,
    },
    expectedNumbers: ['2100000000', '12.6'],
    expectedFigure: '12.6',
    description: 'Runway de 12.6 meses con saldo de $21,000,000 COP y burn rate de $1.67M COP',
  },
] as const;

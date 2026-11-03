/**
 * Implementación de herramientas de prueba para los experimentos de orquestación.
 * Siguen la interfaz estricta de herramientas (ToolDefinition) y representan
 * contratos deterministas de finance-service con montos enteros en Minor (ADR-003).
 */

import type { ToolContext, ToolDefinition, ToolResult } from './types.ts';

/**
 * Herramienta: get_account_balance
 * Consulta de saldos por cuenta o consolidado de tenant.
 */
export const getAccountBalanceTool: ToolDefinition = {
  name: 'get_account_balance',
  description:
    'Obtiene el saldo actual y disponible de una cuenta bancaria del tenant en unidad mínima (Minor).',
  parameters: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description: 'Identificador único de la cuenta bancaria (opcional).',
      },
    },
    required: [],
    additionalProperties: false,
  },
  timeoutMs: 3000,
  auditAction: 'banking.account.balance.read',
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();
    const accountId = (args.accountId as string) || 'acc-operativa-001';

    // Validación de contexto multi-tenant
    if (!ctx.tenantId) {
      return {
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'tenantId es obligatorio en el contexto de ejecución.',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
        citation: 'get_account_balance: error',
      };
    }

    // Datos financieros deterministas (COP 14.250.000 en Minor)
    const data = {
      accountId,
      currency: 'COP',
      currentBalanceMinor: '1425000000',
      availableBalanceMinor: '1425000000',
      institutionName: 'Banco de Bogotá',
      lastSyncedAt: '2026-11-03T12:00:00.000Z',
    };

    return {
      success: true,
      data,
      executionTimeMs: Date.now() - start,
      citation: `get_account_balance:${accountId} [COP ${data.availableBalanceMinor}]`,
    };
  },
};

/**
 * Herramienta: get_cashflow_summary
 * Resumen consolidado de ingresos, egresos y neto en unidad mínima.
 */
export const getCashflowSummaryTool: ToolDefinition = {
  name: 'get_cashflow_summary',
  description:
    'Calcula el resumen de flujo de caja (ingresos, egresos y neto en unidad menor) para un rango de fechas.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Fecha inicial del periodo (ISO 8601 YYYY-MM-DD).',
      },
      to: {
        type: 'string',
        description: 'Fecha final del periodo (ISO 8601 YYYY-MM-DD).',
      },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  timeoutMs: 4000,
  auditAction: 'finance.cashflow.summary.read',
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();
    const from = (args.from as string) || '2026-11-01';
    const to = (args.to as string) || '2026-11-30';

    if (!ctx.tenantId) {
      return {
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'tenantId es obligatorio en el contexto de ejecución.',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
        citation: 'get_cashflow_summary: error',
      };
    }

    // Simulación de respuesta agregada del backend (ADR-003: enteros en Minor)
    // Inflow: 48.500.000 COP, Outflow: 31.200.000 COP, Net: 17.300.000 COP
    const data = {
      from,
      to,
      currency: 'COP',
      totalInflowMinor: '4850000000',
      totalOutflowMinor: '3120000000',
      netCashflowMinor: '1730000000',
      transactionCount: 42,
    };

    return {
      success: true,
      data,
      executionTimeMs: Date.now() - start,
      citation: `get_cashflow_summary:${from}..${to} [Net COP ${data.netCashflowMinor}]`,
    };
  },
};

/**
 * Herramienta: list_unreconciled_transactions
 * Transacciones bancarias que no tienen match con documento o factura.
 */
export const listUnreconciledTransactionsTool: ToolDefinition = {
  name: 'list_unreconciled_transactions',
  description:
    'Lista las transacciones bancarias pendientes de conciliación que requieren atención humana.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Cantidad máxima de movimientos a retornar (1-50, por defecto 5).',
      },
    },
    required: [],
    additionalProperties: false,
  },
  timeoutMs: 3000,
  auditAction: 'banking.reconciliation.unreconciled.list',
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 50) : 5;

    if (!ctx.tenantId) {
      return {
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'tenantId es obligatorio en el contexto de ejecución.',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
        citation: 'list_unreconciled_transactions: error',
      };
    }

    // Dos transacciones bancarias pendientes de conciliar
    const items = [
      {
        id: 'tx-aws-001',
        date: '2026-11-02',
        amountMinor: '350000000', // 3.500.000 COP
        currency: 'COP',
        name: 'PAGO FACTURA AWS CLOUD',
        institution: 'Banco de Bogotá',
      },
      {
        id: 'tx-papeleria-002',
        date: '2026-11-02',
        amountMinor: '120000000', // 1.200.000 COP
        currency: 'COP',
        name: 'COMPRA SUMINISTROS PAPELERIA S.A.S.',
        institution: 'Bancolombia',
      },
    ].slice(0, limit);

    return {
      success: true,
      data: {
        totalUnreconciled: items.length,
        items,
      },
      executionTimeMs: Date.now() - start,
      citation: `list_unreconciled_transactions:${items.map((i) => i.id).join(',')}`,
    };
  },
};

export const allTools: ToolDefinition[] = [
  getAccountBalanceTool,
  getCashflowSummaryTool,
  listUnreconciledTransactionsTool,
];

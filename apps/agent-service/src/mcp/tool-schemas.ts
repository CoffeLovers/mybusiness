import { z } from 'zod';
import type { McpToolDescriptor, McpToolName } from '@mybusiness/contracts';

/** Versión del contrato de la herramienta de resumen de cashflow. */
export const CASHFLOW_TOOL_VERSION = '1.0.0';
/** Versión del contrato de la herramienta de transacciones sin conciliar. */
export const LEDGER_TOOL_VERSION = '1.0.0';
/** Versión del contrato de la herramienta de enlaces de cobro PayPal. */
export const PAYMENT_LINK_TOOL_VERSION = '1.0.0';
/** Versión global del esquema de herramientas expuesto por el servidor MCP. */
export const MCP_SCHEMA_VERSION = '1.0.0';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Fecha en formato `YYYY-MM-DD`. Se valida el patrón y que la fecha sea
 * representable, sin reutilizar mensajes que incluyan el valor recibido.
 */
const isoDate = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Debe tener el formato YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Debe ser una fecha ISO válida',
  });

const currencyCode = z
  .string()
  .regex(CURRENCY_PATTERN, 'Debe ser un código ISO de 3 letras')
  .transform((value) => value.toUpperCase());

const pageNumber = z
  .number()
  .int('Debe ser un número entero')
  .min(1, 'El mínimo es 1')
  .max(10000, 'El máximo es 10000');

const pageSizeNumber = z
  .number()
  .int('Debe ser un número entero')
  .min(1, 'El mínimo es 1')
  .max(200, 'El máximo es 200');

const accountId = z.string().uuid('Debe ser un UUID válido');

/**
 * Esquemas estrictos: cualquier propiedad desconocida provoca un fallo de
 * validación para impedir que el modelo inyecte campos del contexto (tenantId,
 * userId, role) o parámetros no soportados en el payload RPC.
 */
const GetCashflowSummarySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    currency: currencyCode.optional(),
  })
  .strict();

const ListUnreconciledSchema = z
  .object({
    page: pageNumber.optional(),
    pageSize: pageSizeNumber.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    accountId: accountId.optional(),
  })
  .strict();

/**
 * Importe estrictamente positivo en unidad mínima: siempre string entero
 * (nunca `number` ni decimales); la conversión a decimal del proveedor ocurre
 * en finance-service vía `minorToPayPalDecimal` (ADR 003).
 */
const positiveAmountMinor = z
  .string()
  .regex(/^[1-9]\d*$/, 'Debe ser un entero positivo en unidad mínima (sin decimales ni signo)')
  .max(19, 'Excede el límite de dígitos monetarios');

const CreatePaymentLinkSchema = z
  .object({
    amountMinor: positiveAmountMinor,
    currency: currencyCode,
    description: z.string().trim().min(1).max(127).optional(),
    invoiceId: accountId,
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'La clave de idempotencia es muy corta')
      .max(255)
      .optional(),
  })
  .strict();

/** Nombres de herramienta alineados con `McpToolName` del paquete de contratos. */
const MCP_TOOL_NAME_VALUES = [
  'get_cashflow_summary',
  'list_unreconciled_transactions',
  'create_payment_link',
] as const satisfies readonly McpToolName[];

export const McpToolNameSchema = z.enum(MCP_TOOL_NAME_VALUES);

const CASHFLOW_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: {
      type: 'string',
      format: 'date',
      description: 'Fecha inicial del periodo en formato YYYY-MM-DD (inclusive).',
    },
    to: {
      type: 'string',
      format: 'date',
      description: 'Fecha final del periodo en formato YYYY-MM-DD (inclusive).',
    },
    currency: {
      type: 'string',
      pattern: '^[A-Za-z]{3}$',
      description: 'Código ISO 4217 de 3 letras para filtrar por moneda. Opcional.',
    },
  },
  required: ['from', 'to'],
};

const LEDGER_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: {
      type: 'integer',
      minimum: 1,
      maximum: 10000,
      description: 'Número de página (1-based). Por defecto 1.',
    },
    pageSize: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      description: 'Cantidad de transacciones por página. Por defecto 20.',
    },
    from: {
      type: 'string',
      format: 'date',
      description: 'Fecha inicial del rango en formato YYYY-MM-DD (inclusive). Opcional.',
    },
    to: {
      type: 'string',
      format: 'date',
      description: 'Fecha final del rango en formato YYYY-MM-DD (inclusive). Opcional.',
    },
    accountId: {
      type: 'string',
      format: 'uuid',
      description: 'Identificador de la cuenta bancaria a filtrar. Opcional.',
    },
  },
  required: [],
};

const PAYMENT_LINK_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amountMinor: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
      description:
        'Importe entero estrictamente positivo en unidad mínima de la moneda (centavos), como string. Nunca un número flotante ni un valor decimal.',
    },
    currency: {
      type: 'string',
      pattern: '^[A-Za-z]{3}$',
      description: 'Código ISO 4217 de la moneda (3 letras).',
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 127,
      description: 'Descripción visible para el pagador (opcional, máx. 127 caracteres).',
    },
    invoiceId: {
      type: 'string',
      format: 'uuid',
      description: 'Identificador de la factura del libro mayor que respalda el cobro.',
    },
    idempotencyKey: {
      type: 'string',
      minLength: 8,
      maxLength: 255,
      description:
        'Clave opcional de idempotencia; si se omita usa el identificador de la invocación.',
    },
  },
  required: ['amountMinor', 'currency', 'invoiceId'],
};

/** Catálogo de herramientas de solo lectura expuesto por `tools/list`. */
export const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: 'get_cashflow_summary',
    version: CASHFLOW_TOOL_VERSION,
    description:
      'Obtiene el resumen de flujo de caja del tenant para un periodo (ingresos, egresos y saldo neto). Solo lectura.',
    inputSchema: CASHFLOW_INPUT_SCHEMA,
  },
  {
    name: 'list_unreconciled_transactions',
    version: LEDGER_TOOL_VERSION,
    description:
      'Lista paginada de transacciones del mayor pendientes de conciliar (estado UNMATCHED). Solo lectura.',
    inputSchema: LEDGER_INPUT_SCHEMA,
  },
  {
    name: 'create_payment_link',
    version: PAYMENT_LINK_TOOL_VERSION,
    description:
      'Crea una orden PayPal idempotente asociada a una factura y devuelve el enlace de checkout (rel=approve). Requiere permiso de cobro (payments:write).',
    inputSchema: PAYMENT_LINK_INPUT_SCHEMA,
  },
];

const TOOL_SCHEMAS: Record<McpToolName, z.ZodType> = {
  get_cashflow_summary: GetCashflowSummarySchema,
  list_unreconciled_transactions: ListUnreconciledSchema,
  create_payment_link: CreatePaymentLinkSchema,
};

function formatIssue(issue: z.ZodIssue): string {
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/**
 * Valida los argumentos de una herramienta con Zod en modo `strict`.
 * Devuelve los valores normalizados o una lista de incidencias con ruta y
 * mensaje (nunca los valores recibidos, para no filtrar datos del tenant).
 */
export function validateToolArguments(
  name: McpToolName,
  args: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; issues: string[] } {
  const schema = TOOL_SCHEMAS[name];
  const parsed = schema.safeParse(args);

  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(formatIssue) };
  }

  return { ok: true, value: parsed.data };
}

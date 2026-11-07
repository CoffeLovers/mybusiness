import { describe, expect, it } from 'vitest';
import {
  CASHFLOW_TOOL_VERSION,
  LEDGER_TOOL_VERSION,
  PAYMENT_LINK_TOOL_VERSION,
  MCP_SCHEMA_VERSION,
  MCP_TOOLS,
  GetCashflowSummarySchema,
  ListUnreconciledSchema,
  CreatePaymentLinkSchema,
  CashflowSummaryOutputSchema,
  LedgerPageOutputSchema,
  CreatePaymentLinkOutputSchema,
  validateToolArguments,
} from '../../src/mcp/tool-schemas';

describe('MCP Contract Tests (SF3-06)', () => {
  const VALID_UUID = '11111111-1111-4111-8111-111111111111';

  describe('Metadatos y versiones de catálogo MCP', () => {
    it('declara la versión semver de cada herramienta y versión global', () => {
      expect(CASHFLOW_TOOL_VERSION).toBe('1.0.0');
      expect(LEDGER_TOOL_VERSION).toBe('1.0.0');
      expect(PAYMENT_LINK_TOOL_VERSION).toBe('1.0.0');
      expect(MCP_SCHEMA_VERSION).toBe('1.0.0');
    });

    it('expone exactamente 3 herramientas en el catálogo versionado con additionalProperties: false', () => {
      expect(MCP_TOOLS).toHaveLength(3);
      const names = MCP_TOOLS.map((t) => t.name);
      expect(names).toEqual([
        'get_cashflow_summary',
        'list_unreconciled_transactions',
        'create_payment_link',
      ]);

      for (const tool of MCP_TOOLS) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.version).toBe('1.0.0');
      }
    });
  });

  describe('Herramienta 1: get_cashflow_summary', () => {
    it('acepta argumentos válidos de entrada', () => {
      const valid = { from: '2026-01-01', to: '2026-01-31', currency: 'cop' };
      const parsed = GetCashflowSummarySchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.currency).toBe('COP');
        expect(parsed.data.from).toBe('2026-01-01');
        expect(parsed.data.to).toBe('2026-01-31');
      }
    });

    it('rechaza propiedades adicionales inyectadas (modo estricto anti-spoofing)', () => {
      const injected = {
        from: '2026-01-01',
        to: '2026-01-31',
        tenantId: VALID_UUID,
        role: 'ADMIN',
      };
      const result = validateToolArguments('get_cashflow_summary', injected);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.toLowerCase().includes('unrecognized'))).toBe(
          true,
        );
      }
    });

    it.each([
      ['fecha inválida', { from: '2026-02-31', to: '2026-03-01' }],
      ['formato no ISO', { from: '01/01/2026', to: '2026-01-31' }],
      ['moneda con formato incorrecto', { from: '2026-01-01', to: '2026-01-31', currency: 'CO' }],
      ['campo obligatorio ausente', { from: '2026-01-01' }],
    ])('rechaza entrada inválida (%s)', (_label, input) => {
      const parsed = GetCashflowSummarySchema.safeParse(input);
      expect(parsed.success).toBe(false);
    });

    it('valida contrato de salida completo de CashflowSummaryResponse', () => {
      const validOutput = {
        hasData: true,
        currency: 'COP',
        availableCurrencies: ['COP', 'USD'],
        period: { from: '2026-01-01', to: '2026-01-31' },
        balanceMinor: '1500000000',
        incomeMinor: '250000000',
        expenseMinor: '0',
        burnRateMinor: '0',
        runwayMonths: 12.5,
        previousPeriod: {
          incomeMinor: '200000000',
          expenseMinor: '50000000',
        },
        series: [
          {
            bucketStart: '2026-01-01',
            incomeMinor: '250000000',
            expenseMinor: '0',
          },
        ],
        categories: [
          {
            category: 'Servicios Profesionales',
            amountMinor: '250000000',
            share: 1,
          },
        ],
      };

      const parsed = CashflowSummaryOutputSchema.safeParse(validOutput);
      expect(parsed.success).toBe(true);
    });

    it('valida contrato de salida cuando no hay datos (hasData: false con métricas nulas)', () => {
      const emptyOutput = {
        hasData: false,
        currency: 'COP',
        availableCurrencies: ['COP'],
        period: { from: '2026-01-01', to: '2026-01-31' },
        balanceMinor: null,
        incomeMinor: null,
        expenseMinor: null,
        burnRateMinor: null,
        runwayMonths: null,
        previousPeriod: null,
        series: [],
        categories: [],
      };

      const parsed = CashflowSummaryOutputSchema.safeParse(emptyOutput);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Herramienta 2: list_unreconciled_transactions', () => {
    it('acepta argumentos válidos de paginación y filtros', () => {
      const valid = {
        page: 2,
        pageSize: 50,
        from: '2026-01-01',
        to: '2026-01-31',
        accountId: VALID_UUID,
      };
      const parsed = ListUnreconciledSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('acepta argumentos vacíos usando valores por defecto del servidor', () => {
      const parsed = ListUnreconciledSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it('rechaza propiedades adicionales inyectadas', () => {
      const injected = {
        reconciliationStatus: 'MANUAL_MATCHED',
        tenantId: VALID_UUID,
      };
      const result = validateToolArguments('list_unreconciled_transactions', injected);
      expect(result.ok).toBe(false);
    });

    it.each([
      ['página 0', { page: 0 }],
      ['página negativa', { page: -1 }],
      ['página float', { page: 1.5 }],
      ['pageSize menor a 1', { pageSize: 0 }],
      ['pageSize mayor a 200', { pageSize: 201 }],
      ['accountId no es UUID', { accountId: 'not-a-uuid' }],
    ])('rechaza entrada con límites inválidos (%s)', (_label, input) => {
      const parsed = ListUnreconciledSchema.safeParse(input);
      expect(parsed.success).toBe(false);
    });

    it('valida contrato de salida completo de LedgerPageResponse', () => {
      const validOutput = {
        rows: [
          {
            id: 'tx-001',
            date: '2026-01-15',
            name: 'PAGO CLIENTE EJEMPLO',
            merchantName: 'Cliente Ejemplo S.A.S.',
            category: 'Ingresos',
            notes: null,
            amountMinor: '250000000',
            isoCurrencyCode: 'COP',
            accountId: VALID_UUID,
            accountName: 'Bancolombia Demo',
            reconciliationStatus: 'UNMATCHED',
            evidence: null,
            updatedAt: '2026-01-15T12:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
      };

      const parsed = LedgerPageOutputSchema.safeParse(validOutput);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Herramienta 3: create_payment_link', () => {
    it('acepta argumentos válidos de creación de orden de cobro', () => {
      const valid = {
        amountMinor: '250000000',
        currency: 'cop',
        description: 'Cobro de factura FAC-DEMO-0001',
        invoiceId: VALID_UUID,
        idempotencyKey: 'golden-key-12345',
      };
      const parsed = CreatePaymentLinkSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.currency).toBe('COP');
        expect(parsed.data.amountMinor).toBe('250000000');
      }
    });

    it('rechaza importes negativos, cero o decimales (ADR 003 y strict minor)', () => {
      for (const invalidAmount of ['0', '-100', '250.50', 'abc']) {
        const parsed = CreatePaymentLinkSchema.safeParse({
          amountMinor: invalidAmount,
          currency: 'COP',
          invoiceId: VALID_UUID,
        });
        expect(parsed.success).toBe(false);
      }
    });

    it('rechaza propiedades adicionales inyectadas', () => {
      const injected = {
        amountMinor: '10000',
        currency: 'USD',
        invoiceId: VALID_UUID,
        captureImmediately: true,
      };
      const result = validateToolArguments('create_payment_link', injected);
      expect(result.ok).toBe(false);
    });

    it('valida contrato de salida de CreatePaymentLinkResult', () => {
      const validOutput = {
        paypalOrderId: 'PAYPAL-ORD-98765',
        status: 'CREATED',
        checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORD-98765',
        amountMinor: '250000000',
        currency: 'COP',
      };

      const parsed = CreatePaymentLinkOutputSchema.safeParse(validOutput);
      expect(parsed.success).toBe(true);
    });

    it('rechaza salida si checkoutUrl no es URL válida o faltan datos requeridos', () => {
      const invalidOutput = {
        paypalOrderId: 'PAYPAL-ORD-98765',
        status: 'CREATED',
        checkoutUrl: 'not-a-valid-url',
        amountMinor: '250000000',
        currency: 'COP',
      };

      const parsed = CreatePaymentLinkOutputSchema.safeParse(invalidOutput);
      expect(parsed.success).toBe(false);
    });
  });
});

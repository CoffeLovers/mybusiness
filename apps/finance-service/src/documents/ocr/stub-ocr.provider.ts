import type { OcrExtraction, OcrInput, OcrProvider } from './ocr-provider.interface';

/**
 * Proveedor OCR de mentira para desarrollo y pruebas.
 * Devuelve siempre la misma factura y nunca realiza llamadas de red.
 * No debe usarse en entornos productivos.
 */
export class StubOcrProvider implements OcrProvider {
  readonly name = 'stub' as const;

  async extract(_input: OcrInput): Promise<OcrExtraction> {
    return {
      providerName: 'Proveedor de Prueba S.L.',
      taxId: 'B12345678',
      issueDate: '2026-10-01',
      currency: 'EUR',
      totalMinor: '121000',
      lineItems: [
        {
          description: 'Consultoría',
          quantity: 1,
          unitPriceMinor: '100000',
          taxRateBps: 2100,
          totalMinor: '121000',
        },
      ],
      confidence: 0.97,
      raw: { stub: true },
    };
  }
}

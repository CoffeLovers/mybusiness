import { BadGatewayException } from '@nestjs/common';
import type { ConfigReader } from '@mybusiness/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeConfidence,
  normalizeCurrency,
  normalizeDate,
  normalizeOcrExtraction,
  parseDecimalToMinor,
} from '../src/documents/ocr/normalize-ocr-result';
import { MindeeOcrProvider } from '../src/documents/ocr/mindee-ocr.provider';
import { createOcrProvider } from '../src/documents/ocr/ocr.factory';
import { StubOcrProvider } from '../src/documents/ocr/stub-ocr.provider';

function fakeConfig(values: Record<string, string>): ConfigReader {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const value = values[key];
      return value === undefined ? defaultValue : (value as unknown as T);
    },
  };
}

describe('parseDecimalToMinor', () => {
  it('convierte decimales con punto', () => {
    expect(parseDecimalToMinor('1234.56')).toBe('123456');
  });

  it('elimina separadores de miles europeos', () => {
    expect(parseDecimalToMinor('1.234,56')).toBe('123456');
  });

  it('elimina separadores de miles anglosajones', () => {
    expect(parseDecimalToMinor('1,234.56')).toBe('123456');
  });

  it('convierte números y redondea una cifra decimal', () => {
    expect(parseDecimalToMinor(123.4)).toBe('12340');
  });

  it('acepta cero', () => {
    expect(parseDecimalToMinor('0')).toBe('0');
  });

  it('devuelve null para entradas no numéricas', () => {
    expect(parseDecimalToMinor('abc')).toBeNull();
    expect(parseDecimalToMinor(null)).toBeNull();
    expect(parseDecimalToMinor(Number.NaN)).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('acepta ISO válida', () => {
    expect(normalizeDate('2026-10-01')).toBe('2026-10-01');
  });

  it('convierte DD/MM/YYYY a ISO', () => {
    expect(normalizeDate('01/10/2026')).toBe('2026-10-01');
  });

  it('rechaza fechas imposibles', () => {
    expect(normalizeDate('31/02/2026')).toBeNull();
  });
});

describe('normalizeCurrency', () => {
  it('normaliza a mayúsculas', () => {
    expect(normalizeCurrency('eur')).toBe('EUR');
  });

  it('rechaza códigos que no son de tres letras', () => {
    expect(normalizeCurrency('EURO')).toBeNull();
  });
});

describe('normalizeConfidence', () => {
  it('mantiene valores entre 0 y 1', () => {
    expect(normalizeConfidence(0.9)).toBe(0.9);
  });

  it('interpreta porcentajes enteros', () => {
    expect(normalizeConfidence(90)).toBe(0.9);
  });

  it('rechaza valores ambiguos fuera de rango', () => {
    expect(normalizeConfidence(1.5)).toBeNull();
  });

  it('acepta cadenas numéricas', () => {
    expect(normalizeConfidence('0.8')).toBe(0.8);
  });
});

describe('normalizeOcrExtraction', () => {
  it('mapea una predicción completa tipo Mindee', () => {
    const extraction = normalizeOcrExtraction({
      supplier: {
        name: { value: 'ACME S.L.' },
        company_registration_number: { value: 'B12345678' },
      },
      date: { value: '2026-10-01' },
      total_amount: { value: '121.00' },
      currency: { value: 'eur' },
      confidence: 0.95,
      line_items: [
        {
          description: 'Consultoría',
          quantity: 2,
          unit_price: '50.00',
          tax_rate: 21,
          total_amount: '121.00',
        },
      ],
      invoice_number: { value: 'FAC-2026-99' },
    });

    expect(extraction.providerName).toBe('ACME S.L.');
    expect(extraction.taxId).toBe('B12345678');
    expect(extraction.issueDate).toBe('2026-10-01');
    expect(extraction.currency).toBe('EUR');
    expect(extraction.totalMinor).toBe('12100');
    expect(extraction.invoiceNumber).toBe('FAC-2026-99');
    expect(extraction.confidence).toBe(0.95);
    expect(extraction.lineItems).toEqual([
      {
        description: 'Consultoría',
        quantity: 2,
        unitPriceMinor: '5000',
        taxRateBps: 2100,
        totalMinor: '12100',
      },
    ]);
  });

  it('no lanza con una predicción vacía', () => {
    const extraction = normalizeOcrExtraction({});

    expect(extraction.providerName).toBeNull();
    expect(extraction.taxId).toBeNull();
    expect(extraction.issueDate).toBeNull();
    expect(extraction.currency).toBeNull();
    expect(extraction.totalMinor).toBeNull();
    expect(extraction.invoiceNumber).toBeNull();
    expect(extraction.confidence).toBeNull();
    expect(extraction.lineItems).toEqual([]);
  });
});

describe('StubOcrProvider', () => {
  it('devuelve la factura de prueba esperada', async () => {
    const provider = new StubOcrProvider();

    await expect(
      provider.extract({
        buffer: Buffer.from('no importa'),
        mimeType: 'application/pdf',
        originalName: 'factura.pdf',
      }),
    ).resolves.toEqual({
      providerName: 'Proveedor de Prueba S.L.',
      taxId: 'B12345678',
      issueDate: '2026-10-01',
      currency: 'EUR',
      totalMinor: '121000',
      invoiceNumber: 'FAC-DEMO-0001',
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
    });
    expect(provider.name).toBe('stub');
  });
});

describe('MindeeOcrProvider', () => {
  const documentMarker = 'CONTENIDO-SECRETO-DEL-DOCUMENTO';
  const input = {
    buffer: Buffer.from(documentMarker),
    mimeType: 'application/pdf',
    originalName: 'factura.pdf',
  };

  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normaliza una respuesta correcta y llama al endpoint esperado', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          api_request: { status: 'success' },
          document: {
            inference: {
              prediction: {
                supplier: {
                  name: { value: 'ACME S.L.' },
                  company_registration_number: { value: 'B12345678' },
                },
                date: { value: '2026-10-01' },
                total_amount: { value: '121.00' },
                currency: { value: 'EUR' },
                line_items: [],
              },
              pages: [{ confidence: 0.98 }],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const provider = new MindeeOcrProvider({ apiKey: 'test-key' });
    const extraction = await provider.extract(input);

    expect(extraction.providerName).toBe('ACME S.L.');
    expect(extraction.totalMinor).toBe('12100');
    expect(extraction.confidence).toBe(0.98);
    expect(provider.name).toBe('mindee');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mindee.net/v1/products/mindee/invoices/v1/predict');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Token test-key');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('lanza BadGatewayException con el status y sin el cuerpo', async () => {
    fetchMock.mockResolvedValue(
      new Response(documentMarker, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const provider = new MindeeOcrProvider({ apiKey: 'test-key' });

    await expect(provider.extract(input)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(provider.extract(input)).rejects.toThrow('Mindee respondió 500');

    try {
      await provider.extract(input);
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).message).not.toContain(documentMarker);
    }
  });

  it('lanza BadGatewayException si falta la predicción', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ document: { inference: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const provider = new MindeeOcrProvider({ apiKey: 'test-key' });

    await expect(provider.extract(input)).rejects.toThrow('Respuesta de Mindee inválida');
  });

  it('no registra el contenido del documento ni la API key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ document: { inference: { prediction: {} } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const provider = new MindeeOcrProvider({ apiKey: 'clave-privada' });
    await provider.extract(input);

    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        const logged = call.map((argument: unknown) => String(argument)).join(' ');
        expect(logged).not.toContain(documentMarker);
        expect(logged).not.toContain('clave-privada');
      }
    }
  });
});

describe('createOcrProvider', () => {
  afterEach(() => {
    delete process.env.MINDEE_API_KEY;
  });

  it('usa el stub por defecto', () => {
    expect(createOcrProvider(fakeConfig({}))).toBeInstanceOf(StubOcrProvider);
  });

  it('exige MINDEE_API_KEY para el proveedor mindee', () => {
    delete process.env.MINDEE_API_KEY;

    expect(() => createOcrProvider(fakeConfig({ OCR_PROVIDER: 'mindee' }))).toThrow(
      'MINDEE_API_KEY',
    );
  });

  it('rechaza proveedores desconocidos', () => {
    expect(() => createOcrProvider(fakeConfig({ OCR_PROVIDER: 'ftp' }))).toThrow(
      'OCR_PROVIDER inválido',
    );
  });
});

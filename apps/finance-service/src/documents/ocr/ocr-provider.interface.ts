export interface OcrLineItem {
  description: string;
  quantity: number;
  unitPriceMinor: string;
  taxRateBps: number;
  totalMinor: string;
}

export interface OcrExtraction {
  providerName: string | null;
  taxId: string | null;
  issueDate: string | null;
  currency: string | null;
  totalMinor: string | null;
  lineItems: OcrLineItem[];
  /** 0..1; el proveedor puede no informarlo (null). */
  confidence: number | null;
  raw: Record<string, unknown>;
}

export interface OcrInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface OcrProvider {
  readonly name: 'mindee' | 'stub';
  extract(input: OcrInput): Promise<OcrExtraction>;
}

export const OCR_PROVIDER = Symbol('OCR_PROVIDER');

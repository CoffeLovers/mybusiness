import { BadGatewayException } from '@nestjs/common';
import { normalizeConfidence, normalizeOcrExtraction } from './normalize-ocr-result';
import type { OcrExtraction, OcrInput, OcrProvider } from './ocr-provider.interface';

const DEFAULT_BASE_URL = 'https://api.mindee.net/v1';
const DEFAULT_MODEL = 'invoices';
const REQUEST_TIMEOUT_MS = 30000;

export interface MindeeOcrProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface MindeePredictionResponse {
  api_request?: { status?: string };
  document?: {
    inference?: {
      prediction?: Record<string, unknown>;
      pages?: Array<{ prediction?: Record<string, unknown>; confidence?: number }>;
    };
  };
}

/**
 * Extracción de facturas mediante la API de Mindee.
 * La clave y el contenido del documento nunca se registran en logs.
 */
export class MindeeOcrProvider implements OcrProvider {
  readonly name = 'mindee' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: MindeeOcrProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.MINDEE_API_KEY ?? '';
    this.baseUrl = options.baseUrl ?? process.env.MINDEE_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.MINDEE_MODEL ?? DEFAULT_MODEL;
  }

  async extract(input: OcrInput): Promise<OcrExtraction> {
    const formData = new FormData();
    const bytes = new Uint8Array(input.buffer.byteLength);
    bytes.set(input.buffer);
    formData.append('document', new Blob([bytes], { type: input.mimeType }), input.originalName);

    const response = await fetch(this.predictUrl(), {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // No se incluye el cuerpo de la respuesta: puede contener datos del documento.
      throw new BadGatewayException(`Mindee respondió ${response.status}`);
    }

    const payload = await this.readPayload(response);
    const inference = payload.document?.inference;
    const prediction = inference?.prediction;

    if (typeof prediction !== 'object' || prediction === null) {
      throw new BadGatewayException('Respuesta de Mindee inválida');
    }

    const extraction = normalizeOcrExtraction(prediction);
    const pageConfidence = normalizeConfidence(inference?.pages?.[0]?.confidence);

    return {
      ...extraction,
      confidence: pageConfidence ?? extraction.confidence,
    };
  }

  private predictUrl(): string {
    const baseUrl = this.baseUrl.replace(/\/+$/, '');
    return `${baseUrl}/products/mindee/${this.model}/v1/predict`;
  }

  private async readPayload(response: Response): Promise<MindeePredictionResponse> {
    try {
      return (await response.json()) as MindeePredictionResponse;
    } catch {
      throw new BadGatewayException('Respuesta de Mindee inválida');
    }
  }
}

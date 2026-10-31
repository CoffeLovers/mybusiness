import type { ConfigReader } from '@mybusiness/common';
import type { OcrProvider } from './ocr-provider.interface';
import { MindeeOcrProvider } from './mindee-ocr.provider';
import { StubOcrProvider } from './stub-ocr.provider';

/**
 * Construye el proveedor OCR según `OCR_PROVIDER` (`mindee` | `stub`).
 * Por defecto usa el stub, pensado solo para desarrollo y pruebas.
 */
export function createOcrProvider(config: ConfigReader): OcrProvider {
  const driver = config.get<string>('OCR_PROVIDER', 'stub') ?? 'stub';

  if (driver === 'stub') {
    return new StubOcrProvider();
  }

  if (driver === 'mindee') {
    const apiKey = config.get<string>('MINDEE_API_KEY') ?? process.env.MINDEE_API_KEY;
    if (!apiKey) {
      throw new Error('Configuración OCR incompleta: falta MINDEE_API_KEY');
    }
    return new MindeeOcrProvider({
      apiKey,
      baseUrl: config.get<string>('MINDEE_BASE_URL'),
      model: config.get<string>('MINDEE_MODEL'),
    });
  }

  throw new Error('OCR_PROVIDER inválido');
}

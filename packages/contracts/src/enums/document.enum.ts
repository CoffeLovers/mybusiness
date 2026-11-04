/** Ciclo de vida de un documento subido y su extracción OCR. */
export enum DocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  EXTRACTED = 'EXTRACTED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  FAILED = 'FAILED',
}

/** Proveedores de OCR soportados por finance-service. */
export enum DocumentOcrProvider {
  MINDEE = 'mindee',
  STUB = 'stub',
}

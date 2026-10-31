/** Patrones de mensajes RPC del dominio de documentos. */
export const DocumentPatterns = {
  CREATE: 'documents.create',
  GET: 'documents.get',
  SEARCH: 'documents.search',
  DOWNLOAD_URL: 'documents.download_url',
  PROCESS_OCR: 'documents.process_ocr',
} as const;

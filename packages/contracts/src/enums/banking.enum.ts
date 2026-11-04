export enum BankProvider {
  PLAID = 'plaid',
  BELVO = 'belvo',
}

export enum BankConnectionStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  NEEDS_REAUTH = 'needs_reauth',
  ERROR = 'error',
  REVOKED = 'revoked',
  REMOVED = 'removed',
}

/**
 * Estados de procesamiento de un webhook bancario.
 * Se persisten en minúsculas en `bank_webhook_events.processing_status`;
 * equivalen a los estados RECEIVED/PROCESSED/IGNORED/FAILED del issue SF2-05.
 */
export enum BankWebhookProcessingStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
  FAILED = 'failed',
}

/** Patrones de mensajes RPC del dominio de conciliación bancaria. */
export const ReconciliationPatterns = {
  GET_SETTINGS: 'finance.reconciliation.settings.get',
  UPDATE_SETTINGS: 'finance.reconciliation.settings.update',
  RUN: 'finance.reconciliation.run',
  LIST_REVIEW: 'finance.reconciliation.review.list',
  CONFIRM_REVIEW: 'finance.reconciliation.review.confirm',
  REJECT_REVIEW: 'finance.reconciliation.review.reject',
  MANUAL_MATCH: 'finance.reconciliation.match.manual',
  GET_METRICS: 'finance.reconciliation.metrics.get',
} as const;

/** Eventos de dominio y auditoría emitidos durante la conciliación. */
export const ReconciliationEvents = {
  RUN: 'banking.reconciliation.run',
  MANUAL_MATCH: 'banking.reconciliation.manual_match',
  REJECT: 'banking.reconciliation.reject',
} as const;

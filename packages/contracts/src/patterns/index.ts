export const AuthPatterns = {
  LOGIN: 'auth.login',
  REGISTER: 'auth.register',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  VALIDATE_TOKEN: 'auth.validate_token',
  GET_PROFILE: 'auth.get_profile',
} as const;

export const FinancePatterns = {
  GET_ACCOUNTS: 'finance.accounts.get',
  CREATE_ACCOUNT: 'finance.accounts.create',
  GET_TRANSACTIONS: 'finance.transactions.get',
  CREATE_TRANSACTION: 'finance.transactions.create',
  GET_INVOICES: 'finance.invoices.get',
  CREATE_INVOICE: 'finance.invoices.create',
  PAY_INVOICE: 'finance.invoices.pay',
} as const;

export const AgentPatterns = {
  QUERY_MEMORY: 'agent.memory.query',
  STORE_MEMORY: 'agent.memory.store',
  DELETE_MEMORY: 'agent.memory.delete',
} as const;

export const AuditEvents = {
  LOG_EVENT: 'audit.log_event',
  LOG: 'audit.log_event',
} as const;

export const AUDIT_LOG_EVENT = AuditEvents.LOG_EVENT;

/** Eventos de dominio emitidos por finance-service. */
export const FinanceEvents = {
  TRANSACTION_CREATED: 'finance.transaction.created',
  INVOICE_PAID: 'finance.invoice.paid',
} as const;

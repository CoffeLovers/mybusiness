export const AuthPatterns = {
  LOGIN: 'auth.login',
  REGISTER: 'auth.register',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
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
  SEARCH_SIMILAR: 'agent.memory.search',
  SEARCH_MEMORY: 'agent.memory.search',
  GET_BUDGET: 'agent.budget.get',
  GET_USAGE: 'agent.budget.usage',
  RESERVE_BUDGET: 'agent.budget.reserve',
  SETTLE_BUDGET: 'agent.budget.settle',
  RELEASE_BUDGET: 'agent.budget.release',
} as const;

export const AGENT_STORE_MEMORY = AgentPatterns.STORE_MEMORY;
export const AGENT_SEARCH_SIMILAR = AgentPatterns.SEARCH_SIMILAR;
export const AGENT_QUERY_MEMORY = AgentPatterns.QUERY_MEMORY;
export const AGENT_DELETE_MEMORY = AgentPatterns.DELETE_MEMORY;
export const AGENT_GET_BUDGET = AgentPatterns.GET_BUDGET;
export const AGENT_GET_USAGE = AgentPatterns.GET_USAGE;
export const AGENT_RESERVE_BUDGET = AgentPatterns.RESERVE_BUDGET;
export const AGENT_SETTLE_BUDGET = AgentPatterns.SETTLE_BUDGET;
export const AGENT_RELEASE_BUDGET = AgentPatterns.RELEASE_BUDGET;

export const AgentEvents = {
  BUDGET_EXHAUSTED: 'agent.budget.exhausted',
} as const;

export const AGENT_BUDGET_EXHAUSTED = AgentEvents.BUDGET_EXHAUSTED;

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

export * from './banking.patterns';
export * from './cashflow.patterns';
export * from './documents.patterns';
export * from './reconciliation.patterns';
export * from './ledger.patterns';
export * from '../mcp/mcp.patterns';

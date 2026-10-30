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
} as const;

export const AgentPatterns = {
  QUERY_MEMORY: 'agent.memory.query',
  STORE_MEMORY: 'agent.memory.store',
  DELETE_MEMORY: 'agent.memory.delete',
  SEARCH_SIMILAR: 'agent.memory.search',
  SEARCH_MEMORY: 'agent.memory.search',
} as const;

export const AGENT_STORE_MEMORY = AgentPatterns.STORE_MEMORY;
export const AGENT_SEARCH_SIMILAR = AgentPatterns.SEARCH_SIMILAR;
export const AGENT_QUERY_MEMORY = AgentPatterns.QUERY_MEMORY;
export const AGENT_DELETE_MEMORY = AgentPatterns.DELETE_MEMORY;

export const AuditEvents = {
  LOG_EVENT: 'audit.log_event',
} as const;

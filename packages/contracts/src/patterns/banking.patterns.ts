export const BankingPatterns = {
  CREATE_LINK_OR_CONNECT: 'banking.connection.create_link_or_connect',
  EXCHANGE_CONNECTION: 'banking.connection.exchange',
  GET_CONNECTIONS: 'banking.connections.get',
  GET_CONNECTION_ACCOUNTS: 'banking.connection.accounts.get',
  SYNC_CONNECTION: 'banking.connection.sync',
  DISCONNECT_CONNECTION: 'banking.connection.disconnect',
  HANDLE_WEBHOOK: 'banking.webhook.handle',
} as const;

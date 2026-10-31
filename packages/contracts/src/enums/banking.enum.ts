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

import { BankProvider, TransactionType } from '@mybusiness/contracts';

export interface AdapterContext {
  userId: string;
  tenantId: string;
  [key: string]: unknown;
}

export interface LinkTokenParams extends AdapterContext {
  institutionId?: string;
}

export interface LinkTokenResult {
  linkToken?: string;
  expiration?: string;
  provider: BankProvider;
  [key: string]: unknown;
}

export interface ExchangeParams extends AdapterContext {
  publicToken?: string;
  institution?: string;
  linkId?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedBankAccount {
  providerAccountId: string;
  name: string;
  officialName?: string | null;
  type?: string | null;
  subtype?: string | null;
  mask?: string | null;
  isoCurrencyCode: string;
  balanceCurrentMinor?: bigint | null;
  balanceAvailableMinor?: bigint | null;
  rawMetadata?: Record<string, unknown>;
}

export interface ExchangeResult {
  providerItemId: string;
  accessToken: string;
  institutionId?: string;
  institutionName?: string;
  accounts?: NormalizedBankAccount[];
  rawMetadata?: Record<string, unknown>;
}

export interface NormalizedBankTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  amountMinor: bigint;
  transactionType: TransactionType;
  isoCurrencyCode: string;
  date: string;
  authorizedDate?: string | null;
  name: string;
  merchantName?: string | null;
  category?: string[] | null;
  pending: boolean;
  rawMetadata?: Record<string, unknown>;
}

export interface SyncTransactionsParams {
  accessToken: string;
  cursor?: string | null;
  count?: number;
}

export interface SyncTransactionsResult {
  added: NormalizedBankTransaction[];
  modified: NormalizedBankTransaction[];
  removed: Array<{ providerTransactionId: string }>;
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface DisconnectParams {
  accessToken: string;
  providerItemId: string;
}

export interface WebhookResult {
  providerEventKey: string;
  webhookType: string;
  webhookCode?: string;
  providerItemId?: string;
  rawPayload: Record<string, unknown>;
  /**
   * Momento del evento según el proveedor. Se usa para descartar eventos
   * fuera de orden. Si el proveedor no lo envía, el adaptador puede derivarlo
   * de la firma (p. ej. `iat` del JWT de Plaid).
   */
  occurredAt?: Date | null;
}

/**
 * Interfaz unificada de adaptadores bancarios (Plaid / Belvo).
 * Todos los métodos agnósticos operan bajo esta abstracción.
 */
export interface IBankAdapter {
  readonly provider: BankProvider;

  createLinkOrConnect(ctx: LinkTokenParams): Promise<LinkTokenResult>;

  exchange(ctx: ExchangeParams): Promise<ExchangeResult>;

  getAccounts(ctx: {
    accessToken: string;
    providerItemId?: string;
  }): Promise<NormalizedBankAccount[]>;

  syncTransactions(ctx: SyncTransactionsParams): Promise<SyncTransactionsResult>;

  disconnect(ctx: DisconnectParams): Promise<void>;

  handleWebhook?(
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
    rawBody?: string,
  ): Promise<WebhookResult>;
}

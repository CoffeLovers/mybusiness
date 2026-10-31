import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankProvider } from '@mybusiness/contracts';
import {
  DisconnectParams,
  ExchangeParams,
  ExchangeResult,
  IBankAdapter,
  LinkTokenParams,
  LinkTokenResult,
  NormalizedBankAccount,
  NormalizedBankTransaction,
  SyncTransactionsParams,
  SyncTransactionsResult,
  WebhookResult,
} from './base-adapter.interface';

interface PlaidApiErrorBody {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  display_message?: string;
  request_id?: string;
}

@Injectable()
export class PlaidAdapter implements IBankAdapter {
  readonly provider = BankProvider.PLAID;
  private readonly logger = new Logger(PlaidAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  private getBaseUrl(): string {
    const env = this.configService.get<string>('PLAID_ENV', 'sandbox').toLowerCase();
    switch (env) {
      case 'production':
        return 'https://production.plaid.com';
      case 'development':
        return 'https://development.plaid.com';
      case 'sandbox':
      default:
        return 'https://sandbox.plaid.com';
    }
  }

  private getHeaders(): Record<string, string> {
    const clientId = this.configService.get<string>('PLAID_CLIENT_ID');
    const secret = this.configService.get<string>('PLAID_SECRET');

    if (!clientId || !secret) {
      this.logger.warn(
        'PLAID_CLIENT_ID o PLAID_SECRET no configurados en las variables de entorno.',
      );
    }

    return {
      'Content-Type': 'application/json',
      'PLAID-CLIENT-ID': clientId || '',
      'PLAID-SECRET': secret || '',
      'Plaid-Version': this.configService.get<string>('PLAID_API_VERSION', '2020-09-14'),
    };
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${endpoint}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Timeout o error de red hacia Plaid';
      this.logger.error(`Error de red al conectar con Plaid (${endpoint}): ${message}`);
      throw new BadGatewayException('No fue posible comunicarse con el servicio de Plaid.');
    }

    if (!response.ok) {
      let errorData: PlaidApiErrorBody = {};
      try {
        errorData = (await response.json()) as PlaidApiErrorBody;
      } catch {
        // Ignorar fallo al parsear JSON
      }

      const safeMessage =
        errorData.display_message || errorData.error_message || `HTTP ${response.status} de Plaid`;
      this.logger.error(
        `Error de Plaid en ${endpoint}: [${errorData.error_code || 'UNKNOWN'}] ${safeMessage}`,
      );

      if (response.status === 400 || errorData.error_type === 'INVALID_REQUEST') {
        throw new BadRequestException(`Plaid: ${safeMessage}`);
      }
      throw new BadGatewayException(`Plaid: ${safeMessage}`);
    }

    return (await response.json()) as T;
  }

  async createLinkOrConnect(ctx: LinkTokenParams): Promise<LinkTokenResult> {
    const productsEnv = this.configService.get<string>('PLAID_PRODUCTS', 'transactions');
    const products = productsEnv
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const countryCodesEnv = this.configService.get<string>('PLAID_COUNTRY_CODES', 'US');
    const countryCodes = countryCodesEnv
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const webhookUrl = this.configService.get<string>('PLAID_WEBHOOK_URL');

    const body: Record<string, unknown> = {
      client_name: 'MyBusiness',
      language: 'es',
      country_codes: countryCodes,
      user: {
        client_user_id: ctx.userId,
      },
      products,
    };

    if (webhookUrl) {
      body.webhook = webhookUrl;
    }

    interface LinkTokenCreateResponse {
      link_token: string;
      expiration: string;
      request_id: string;
    }

    const data = await this.request<LinkTokenCreateResponse>('/link/token/create', body);

    return {
      provider: BankProvider.PLAID,
      linkToken: data.link_token,
      expiration: data.expiration,
    };
  }

  async exchange(ctx: ExchangeParams): Promise<ExchangeResult> {
    if (!ctx.publicToken) {
      throw new BadRequestException('El campo publicToken es obligatorio para Plaid.');
    }

    interface PublicTokenExchangeResponse {
      access_token: string;
      item_id: string;
      request_id: string;
    }

    const data = await this.request<PublicTokenExchangeResponse>('/item/public_token/exchange', {
      public_token: ctx.publicToken,
    });

    const institutionId =
      typeof ctx.metadata?.institution_id === 'string' ? ctx.metadata.institution_id : undefined;
    const institutionName =
      typeof ctx.metadata?.institution_name === 'string'
        ? ctx.metadata.institution_name
        : undefined;

    return {
      providerItemId: data.item_id,
      accessToken: data.access_token,
      institutionId,
      institutionName,
      rawMetadata: ctx.metadata || {},
    };
  }

  async getAccounts(ctx: {
    accessToken: string;
    providerItemId?: string;
  }): Promise<NormalizedBankAccount[]> {
    interface PlaidBalance {
      available: number | null;
      current: number | null;
      iso_currency_code: string | null;
      unofficial_currency_code: string | null;
    }

    interface PlaidAccount {
      account_id: string;
      name: string;
      official_name: string | null;
      type: string;
      subtype: string | null;
      mask: string | null;
      balances: PlaidBalance;
    }

    interface AccountsGetResponse {
      accounts: PlaidAccount[];
      item: Record<string, unknown>;
    }

    const data = await this.request<AccountsGetResponse>('/accounts/get', {
      access_token: ctx.accessToken,
    });

    return data.accounts.map((acc) => {
      const currency = acc.balances.iso_currency_code || 'USD';
      const balanceCurrentMinor =
        acc.balances.current != null ? BigInt(Math.round(acc.balances.current * 100)) : null;
      const balanceAvailableMinor =
        acc.balances.available != null ? BigInt(Math.round(acc.balances.available * 100)) : null;

      return {
        providerAccountId: acc.account_id,
        name: acc.name,
        officialName: acc.official_name,
        type: acc.type,
        subtype: acc.subtype,
        mask: acc.mask,
        isoCurrencyCode: currency,
        balanceCurrentMinor,
        balanceAvailableMinor,
        rawMetadata: {
          balances: acc.balances,
          type: acc.type,
          subtype: acc.subtype,
        },
      };
    });
  }

  async syncTransactions(ctx: SyncTransactionsParams): Promise<SyncTransactionsResult> {
    interface PlaidTransaction {
      transaction_id: string;
      account_id: string;
      amount: number;
      iso_currency_code: string | null;
      unofficial_currency_code: string | null;
      date: string;
      authorized_date: string | null;
      name: string;
      merchant_name: string | null;
      category: string[] | null;
      pending: boolean;
    }

    interface PlaidRemovedTransaction {
      transaction_id: string;
    }

    interface TransactionsSyncResponse {
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: PlaidRemovedTransaction[];
      next_cursor: string;
      has_more: boolean;
    }

    const body: Record<string, unknown> = {
      access_token: ctx.accessToken,
      count: ctx.count || 100,
    };

    if (ctx.cursor) {
      body.cursor = ctx.cursor;
    }

    const data = await this.request<TransactionsSyncResponse>('/transactions/sync', body);

    const mapTransaction = (tx: PlaidTransaction): NormalizedBankTransaction => {
      const currency = tx.iso_currency_code || tx.unofficial_currency_code || 'USD';
      // Conforme a ADR-003, importes en unidades menores (cents / BIGINT)
      const amountMinor = BigInt(Math.round(tx.amount * 100));

      return {
        providerTransactionId: tx.transaction_id,
        providerAccountId: tx.account_id,
        amountMinor,
        isoCurrencyCode: currency,
        date: tx.date,
        authorizedDate: tx.authorized_date,
        name: tx.name,
        merchantName: tx.merchant_name,
        category: tx.category || [],
        pending: tx.pending ?? false,
        rawMetadata: {
          plaid_transaction_id: tx.transaction_id,
          original_amount: tx.amount,
        },
      };
    };

    return {
      added: data.added.map(mapTransaction),
      modified: data.modified.map(mapTransaction),
      removed: data.removed.map((r) => ({ providerTransactionId: r.transaction_id })),
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  }

  async disconnect(ctx: DisconnectParams): Promise<void> {
    try {
      await this.request('/item/remove', {
        access_token: ctx.accessToken,
      });
    } catch (err: unknown) {
      // Si el item ya fue revocado en Plaid, registramos el log sin bloquear la revocación local
      this.logger.warn(
        `Error al desconectar item en Plaid: ${err instanceof Error ? err.message : 'Desconocido'}`,
      );
    }
  }

  async handleWebhook(
    payload: Record<string, unknown>,
    _headers?: Record<string, string>,
  ): Promise<WebhookResult> {
    const webhookType = String(payload.webhook_type || 'UNKNOWN');
    const webhookCode = payload.webhook_code ? String(payload.webhook_code) : undefined;
    const providerItemId = payload.item_id ? String(payload.item_id) : undefined;
    const eventKey = `${webhookType}_${providerItemId || 'no_item'}_${webhookCode || 'no_code'}_${Date.now()}`;

    return {
      providerEventKey: eventKey,
      webhookType,
      webhookCode,
      providerItemId,
      rawPayload: payload,
    };
  }
}

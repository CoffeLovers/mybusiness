import { Injectable, NotImplementedException } from '@nestjs/common';
import { BankProvider } from '@mybusiness/contracts';
import {
  DisconnectParams,
  ExchangeParams,
  ExchangeResult,
  IBankAdapter,
  LinkTokenParams,
  LinkTokenResult,
  NormalizedBankAccount,
  SyncTransactionsParams,
  SyncTransactionsResult,
  WebhookResult,
} from './base-adapter.interface';

@Injectable()
export class BelvoAdapter implements IBankAdapter {
  readonly provider = BankProvider.BELVO;

  async createLinkOrConnect(_ctx: LinkTokenParams): Promise<LinkTokenResult> {
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }

  async exchange(_ctx: ExchangeParams): Promise<ExchangeResult> {
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }

  async getAccounts(_ctx: {
    accessToken: string;
    providerItemId?: string;
  }): Promise<NormalizedBankAccount[]> {
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }

  async syncTransactions(_ctx: SyncTransactionsParams): Promise<SyncTransactionsResult> {
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }

  async disconnect(_ctx: DisconnectParams): Promise<void> {
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }

  async handleWebhook(
    _payload: Record<string, unknown>,
    _headers?: Record<string, string>,
    _rawBody?: string,
  ): Promise<WebhookResult> {
    // Belvo no está habilitado en esta versión: se rechaza cualquier webhook entrante.
    // TODO: Implementar la verificación de firma/HMAC de Belvo cuando el adapter esté completo.
    throw new NotImplementedException(
      'La integración con Belvo no está habilitada en esta versión (solo Plaid).',
    );
  }
}

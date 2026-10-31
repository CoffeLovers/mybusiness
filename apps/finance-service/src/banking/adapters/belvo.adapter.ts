import { Injectable, NotImplementedException, UnauthorizedException } from '@nestjs/common';
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
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }

  async exchange(_ctx: ExchangeParams): Promise<ExchangeResult> {
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }

  async getAccounts(_ctx: {
    accessToken: string;
    providerItemId?: string;
  }): Promise<NormalizedBankAccount[]> {
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }

  async syncTransactions(_ctx: SyncTransactionsParams): Promise<SyncTransactionsResult> {
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }

  async disconnect(_ctx: DisconnectParams): Promise<void> {
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }

  async handleWebhook(
    _payload: Record<string, unknown>,
    _headers?: Record<string, string>,
    _rawBody?: string,
  ): Promise<WebhookResult> {
    // Fail-closed: rechazar cualquier webhook entrante hasta que la verificación
    // criptográfica de autenticidad e integridad (e.g. HMAC-SHA256) esté implementada.
    // TODO: Implementar verificación de firma/HMAC de Belvo cuando el adapter esté completo.
    throw new UnauthorizedException('Verificación de webhooks Belvo no implementada.');
  }
}

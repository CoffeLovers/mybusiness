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
  ): Promise<WebhookResult> {
    throw new NotImplementedException('Belvo adapter not implemented yet');
  }
}

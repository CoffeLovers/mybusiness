import { BadRequestException, Injectable } from '@nestjs/common';
import { BankProvider } from '@mybusiness/contracts';
import { IBankAdapter } from './adapters/base-adapter.interface';
import { PlaidAdapter } from './adapters/plaid.adapter';
import { BelvoAdapter } from './adapters/belvo.adapter';

@Injectable()
export class BankingAggregatorService {
  private readonly adapters: Map<BankProvider, IBankAdapter> = new Map();

  constructor(
    private readonly plaidAdapter: PlaidAdapter,
    private readonly belvoAdapter: BelvoAdapter,
  ) {
    this.adapters.set(BankProvider.PLAID, this.plaidAdapter);
    this.adapters.set(BankProvider.BELVO, this.belvoAdapter);
  }

  getAdapter(provider: BankProvider): IBankAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new BadRequestException(`Proveedor bancario '${provider}' no soportado.`);
    }
    return adapter;
  }
}

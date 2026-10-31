import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BankingPatterns,
  BankProvider,
  ExchangeBankConnectionDto,
  StartBankConnectionDto,
  type UserContext,
} from '@mybusiness/contracts';
import { rpcSend } from '@mybusiness/common';

@Injectable()
export class BankingService {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  createLinkOrConnect(user: UserContext, dto: StartBankConnectionDto) {
    return rpcSend(this.financeClient, BankingPatterns.CREATE_LINK_OR_CONNECT, {
      ...dto,
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  exchangeConnection(user: UserContext, dto: ExchangeBankConnectionDto) {
    return rpcSend(this.financeClient, BankingPatterns.EXCHANGE_CONNECTION, {
      ...dto,
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  getConnections(user: UserContext) {
    return rpcSend(this.financeClient, BankingPatterns.GET_CONNECTIONS, {
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  getConnectionAccounts(user: UserContext, connectionId: string) {
    return rpcSend(this.financeClient, BankingPatterns.GET_CONNECTION_ACCOUNTS, {
      connectionId,
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  syncConnection(user: UserContext, connectionId: string) {
    return rpcSend(
      this.financeClient,
      BankingPatterns.SYNC_CONNECTION,
      {
        connectionId,
        userId: user.userId,
        tenantId: user.tenantId,
        role: user.role,
      },
      15000,
    );
  }

  disconnectConnection(user: UserContext, connectionId: string) {
    return rpcSend(this.financeClient, BankingPatterns.DISCONNECT_CONNECTION, {
      connectionId,
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  handleWebhook(
    provider: BankProvider,
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
    rawBody?: string,
  ) {
    return rpcSend(this.financeClient, BankingPatterns.HANDLE_WEBHOOK, {
      provider,
      payload,
      headers,
      rawBody,
    });
  }
}

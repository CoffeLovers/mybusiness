import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BankingPatterns,
  BankWebhookRpcPayload,
  DisconnectBankConnectionRpcPayload,
  ExchangeBankConnectionDto,
  ExchangeBankConnectionRpcPayload,
  GetBankConnectionAccountsRpcPayload,
  GetBankConnectionsRpcPayload,
  StartBankConnectionDto,
  StartBankConnectionRpcPayload,
  SyncBankConnectionRpcPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { BankingService } from './banking.service';
import { BankingWebhookService } from './banking-webhook.service';

@Controller()
export class BankingController {
  constructor(
    private readonly bankingService: BankingService,
    private readonly webhookService: BankingWebhookService,
  ) {}

  @MessagePattern(BankingPatterns.CREATE_LINK_OR_CONNECT)
  createLinkOrConnect(@Payload() data: StartBankConnectionRpcPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as StartBankConnectionDto;
    return this.bankingService.createLinkOrConnect(ctx, dto);
  }

  @MessagePattern(BankingPatterns.EXCHANGE_CONNECTION)
  exchangeConnection(@Payload() data: ExchangeBankConnectionRpcPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as ExchangeBankConnectionDto;
    return this.bankingService.exchange(ctx, dto);
  }

  @MessagePattern(BankingPatterns.GET_CONNECTIONS)
  getConnections(@Payload() data: GetBankConnectionsRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.bankingService.getConnections(ctx);
  }

  @MessagePattern(BankingPatterns.GET_CONNECTION_ACCOUNTS)
  getConnectionAccounts(@Payload() data: GetBankConnectionAccountsRpcPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as { connectionId: string };
    return this.bankingService.getConnectionAccounts(ctx, dto.connectionId);
  }

  @MessagePattern(BankingPatterns.SYNC_CONNECTION)
  syncConnection(@Payload() data: SyncBankConnectionRpcPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as { connectionId: string };
    return this.bankingService.syncConnection(ctx, dto.connectionId);
  }

  @MessagePattern(BankingPatterns.DISCONNECT_CONNECTION)
  disconnectConnection(@Payload() data: DisconnectBankConnectionRpcPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as { connectionId: string };
    return this.bankingService.disconnectConnection(ctx, dto.connectionId);
  }

  @MessagePattern(BankingPatterns.HANDLE_WEBHOOK)
  handleWebhook(@Payload() data: BankWebhookRpcPayload) {
    return this.webhookService.handleIncomingWebhook(data.provider, data.payload, data.headers);
  }
}

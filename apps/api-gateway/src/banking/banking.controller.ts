import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BankProvider,
  ExchangeBankConnectionDto,
  StartBankConnectionDto,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Public } from '@mybusiness/common';
import { BankingService } from './banking.service';

@ApiTags('Banking')
@ApiBearerAuth()
@Controller('banking')
export class BankingController {
  constructor(private readonly bankingService: BankingService) {}

  @Post('connect')
  connect(@CurrentUser() user: UserContext, @Body() dto: StartBankConnectionDto) {
    return this.bankingService.createLinkOrConnect(user, dto);
  }

  @Post('link-token')
  linkToken(@CurrentUser() user: UserContext, @Body() dto: StartBankConnectionDto) {
    return this.bankingService.createLinkOrConnect(user, dto);
  }

  @Post('exchange')
  exchange(@CurrentUser() user: UserContext, @Body() dto: ExchangeBankConnectionDto) {
    return this.bankingService.exchangeConnection(user, dto);
  }

  @Get('connections')
  getConnections(@CurrentUser() user: UserContext) {
    return this.bankingService.getConnections(user);
  }

  @Get('connections/:id/accounts')
  getConnectionAccounts(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.bankingService.getConnectionAccounts(user, id);
  }

  @Post('connections/:id/sync')
  syncConnection(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.bankingService.syncConnection(user, id);
  }

  @Delete('connections/:id')
  disconnectConnection(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.bankingService.disconnectConnection(user, id);
  }
}

@ApiTags('Webhooks')
@Controller('webhooks')
export class BankingWebhooksController {
  constructor(private readonly bankingService: BankingService) {}

  @Public()
  @Post('plaid')
  handlePlaidWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    return this.bankingService.handleWebhook(BankProvider.PLAID, payload, headers);
  }

  @Public()
  @Post('belvo')
  handleBelvoWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    return this.bankingService.handleWebhook(BankProvider.BELVO, payload, headers);
  }
}

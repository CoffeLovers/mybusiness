import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BankProvider,
  ExchangeBankConnectionDto,
  ReplayBankWebhookDto,
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
  getConnectionAccounts(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bankingService.getConnectionAccounts(user, id);
  }

  @Post('connections/:id/sync')
  syncConnection(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bankingService.syncConnection(user, id);
  }

  @Delete('connections/:id')
  disconnectConnection(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bankingService.disconnectConnection(user, id);
  }
}

const MAX_WEBHOOK_BYTES = 256 * 1024;

@ApiTags('Webhooks')
@Controller('webhooks')
export class BankingWebhooksController {
  constructor(private readonly bankingService: BankingService) {}

  private assertPayloadSize(req: RawBodyRequest<Request>): void {
    if ((req.rawBody?.byteLength ?? 0) > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException('El cuerpo del webhook excede 256 KB.');
    }
  }

  @Public()
  @Post('plaid')
  handlePlaidWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.assertPayloadSize(req);
    return this.bankingService.handleWebhook(
      BankProvider.PLAID,
      payload,
      headers,
      req.rawBody?.toString('utf8'),
    );
  }

  @Public()
  @Post('belvo')
  handleBelvoWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.assertPayloadSize(req);
    return this.bankingService.handleWebhook(
      BankProvider.BELVO,
      payload,
      headers,
      req.rawBody?.toString('utf8'),
    );
  }

  /**
   * Replay manual y auditado de un evento `failed` o `ignored`.
   * Requiere JWT: el tenant se valida en finance-service contra la conexión.
   */
  @ApiBearerAuth()
  @Post(':id/replay')
  replayWebhook(
    @CurrentUser() user: UserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplayBankWebhookDto,
  ) {
    return this.bankingService.replayWebhook(user, id, dto.force ?? false);
  }
}

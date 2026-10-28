import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CreateBankAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  FinancePatterns,
} from '@mybusiness/contracts';
import { CurrentTenant, rpcSend } from '@mybusiness/common';

@ApiTags('Finance')
@SkipThrottle({ auth: true, heavy: true })
@Throttle({ api: { limit: 100, ttl: 60000 } })
@Controller('finance')
export class FinanceGatewayController {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  @Get('accounts')
  getAccounts(@CurrentTenant() tenantId: string) {
    return rpcSend(this.financeClient, FinancePatterns.GET_ACCOUNTS, { tenantId });
  }

  @Post('accounts')
  createAccount(@CurrentTenant() tenantId: string, @Body() dto: CreateBankAccountDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_ACCOUNT, { tenantId, ...dto });
  }

  @Get('transactions')
  getTransactions(@CurrentTenant() tenantId: string) {
    return rpcSend(this.financeClient, FinancePatterns.GET_TRANSACTIONS, { tenantId });
  }

  @Post('transactions')
  createTransaction(@CurrentTenant() tenantId: string, @Body() dto: CreateTransactionDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_TRANSACTION, { tenantId, ...dto });
  }

  @Get('invoices')
  getInvoices(@CurrentTenant() tenantId: string) {
    return rpcSend(this.financeClient, FinancePatterns.GET_INVOICES, { tenantId });
  }

  @Post('invoices')
  createInvoice(@CurrentTenant() tenantId: string, @Body() dto: CreateInvoiceDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_INVOICE, { tenantId, ...dto });
  }
}

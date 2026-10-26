import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateBankAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  FinancePatterns,
} from '@mybusiness/contracts';
import { CurrentTenant } from '@mybusiness/common';

@ApiTags('Finance')
@Controller('finance')
export class FinanceGatewayController {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  @Get('accounts')
  getAccounts(@CurrentTenant() tenantId: string) {
    return this.financeClient.send(FinancePatterns.GET_ACCOUNTS, { tenantId });
  }

  @Post('accounts')
  createAccount(@CurrentTenant() tenantId: string, @Body() dto: CreateBankAccountDto) {
    return this.financeClient.send(FinancePatterns.CREATE_ACCOUNT, { tenantId, ...dto });
  }

  @Get('transactions')
  getTransactions(@CurrentTenant() tenantId: string) {
    return this.financeClient.send(FinancePatterns.GET_TRANSACTIONS, { tenantId });
  }

  @Post('transactions')
  createTransaction(@CurrentTenant() tenantId: string, @Body() dto: CreateTransactionDto) {
    return this.financeClient.send(FinancePatterns.CREATE_TRANSACTION, { tenantId, ...dto });
  }

  @Get('invoices')
  getInvoices(@CurrentTenant() tenantId: string) {
    return this.financeClient.send(FinancePatterns.GET_INVOICES, { tenantId });
  }

  @Post('invoices')
  createInvoice(@CurrentTenant() tenantId: string, @Body() dto: CreateInvoiceDto) {
    return this.financeClient.send(FinancePatterns.CREATE_INVOICE, { tenantId, ...dto });
  }
}

import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CashflowPatterns,
  CashflowSummaryQueryDto,
  CreateBankAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  FinancePatterns,
  PayInvoiceDto,
  type UserContext,
  UserRole,
} from '@mybusiness/contracts';
import { CurrentUser, Roles, rpcSend } from '@mybusiness/common';

@ApiTags('Finance')
@SkipThrottle({ auth: true, heavy: true })
@Throttle({ api: { limit: 100, ttl: 60000 } })
@Controller('finance')
export class FinanceGatewayController {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  @Get('cashflow/summary')
  getCashflowSummary(@CurrentUser() user: UserContext, @Query() query: CashflowSummaryQueryDto) {
    return rpcSend(this.financeClient, CashflowPatterns.SUMMARY, {
      from: query.from,
      to: query.to,
      currency: query.currency,
      compare: query.compare,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Get('accounts')
  getAccounts(@CurrentUser() user: UserContext) {
    return rpcSend(this.financeClient, FinancePatterns.GET_ACCOUNTS, {
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('accounts')
  createAccount(@CurrentUser() user: UserContext, @Body() dto: CreateBankAccountDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_ACCOUNT, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Get('transactions')
  getTransactions(@CurrentUser() user: UserContext) {
    return rpcSend(this.financeClient, FinancePatterns.GET_TRANSACTIONS, {
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('transactions')
  createTransaction(@CurrentUser() user: UserContext, @Body() dto: CreateTransactionDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_TRANSACTION, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Get('invoices')
  getInvoices(@CurrentUser() user: UserContext) {
    return rpcSend(this.financeClient, FinancePatterns.GET_INVOICES, {
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('invoices')
  createInvoice(@CurrentUser() user: UserContext, @Body() dto: CreateInvoiceDto) {
    return rpcSend(this.financeClient, FinancePatterns.CREATE_INVOICE, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('invoices/pay')
  payInvoice(@CurrentUser() user: UserContext, @Body() dto: PayInvoiceDto) {
    return rpcSend(this.financeClient, FinancePatterns.PAY_INVOICE, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }
}

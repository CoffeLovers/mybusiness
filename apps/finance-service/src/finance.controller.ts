import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FinancePatterns,
  type CreateBankAccountRpcPayload,
  type CreateInvoiceRpcPayload,
  type CreateTransactionRpcPayload,
  type FinanceTenantPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { FinanceService } from './finance.service';

@Controller()
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @MessagePattern(FinancePatterns.GET_ACCOUNTS)
  getAccounts(@Payload() data: FinanceTenantPayload) {
    return this.financeService.getAccounts(extractRpcContext(data));
  }

  @MessagePattern(FinancePatterns.CREATE_ACCOUNT)
  createAccount(@Payload() data: CreateBankAccountRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.financeService.createAccount(ctx, stripRpcContext(data));
  }

  @MessagePattern(FinancePatterns.GET_TRANSACTIONS)
  getTransactions(@Payload() data: FinanceTenantPayload) {
    return this.financeService.getTransactions(extractRpcContext(data));
  }

  @MessagePattern(FinancePatterns.CREATE_TRANSACTION)
  createTransaction(@Payload() data: CreateTransactionRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.financeService.createTransaction(ctx, stripRpcContext(data));
  }

  @MessagePattern(FinancePatterns.GET_INVOICES)
  getInvoices(@Payload() data: FinanceTenantPayload) {
    return this.financeService.getInvoices(extractRpcContext(data));
  }

  @MessagePattern(FinancePatterns.CREATE_INVOICE)
  createInvoice(@Payload() data: CreateInvoiceRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.financeService.createInvoice(ctx, stripRpcContext(data));
  }
}

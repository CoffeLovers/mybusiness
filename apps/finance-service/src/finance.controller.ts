import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FinancePatterns } from '@mybusiness/contracts';
import { FinanceService } from './finance.service';

@Controller()
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @MessagePattern(FinancePatterns.GET_ACCOUNTS)
  getAccounts(@Payload() data: { tenantId: string }) {
    return this.financeService.getAccounts(data.tenantId);
  }

  @MessagePattern(FinancePatterns.CREATE_ACCOUNT)
  createAccount(@Payload() data: any) {
    return this.financeService.createAccount(data);
  }

  @MessagePattern(FinancePatterns.GET_TRANSACTIONS)
  getTransactions(@Payload() data: { tenantId: string }) {
    return this.financeService.getTransactions(data.tenantId);
  }

  @MessagePattern(FinancePatterns.CREATE_TRANSACTION)
  createTransaction(@Payload() data: any) {
    return this.financeService.createTransaction(data);
  }

  @MessagePattern(FinancePatterns.GET_INVOICES)
  getInvoices(@Payload() data: { tenantId: string }) {
    return this.financeService.getInvoices(data.tenantId);
  }

  @MessagePattern(FinancePatterns.CREATE_INVOICE)
  createInvoice(@Payload() data: any) {
    return this.financeService.createInvoice(data);
  }
}

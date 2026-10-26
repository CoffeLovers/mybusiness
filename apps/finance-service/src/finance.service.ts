import { Injectable, Logger } from '@nestjs/common';
import { AccountType, TransactionStatus, TransactionType } from '@mybusiness/contracts';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  async getAccounts(tenantId: string) {
    this.logger.log(`Obteniendo cuentas para tenant: ${tenantId}`);
    return [
      {
        id: 'acc-1',
        tenantId,
        institutionName: 'Bancolombia',
        accountType: AccountType.CHECKING,
        accountNumberMasked: '****4589',
        currency: 'COP',
        currentBalance: 15420000,
        availableBalance: 15420000,
      },
    ];
  }

  async createAccount(data: any) {
    return {
      id: 'acc-' + Math.random().toString(36).substring(2, 9),
      ...data,
      createdAt: new Date().toISOString(),
    };
  }

  async getTransactions(tenantId: string) {
    this.logger.log(`Obteniendo transacciones para tenant: ${tenantId}`);
    return [
      {
        id: 'tx-1',
        tenantId,
        amount: 250000,
        currency: 'COP',
        type: TransactionType.EXPENSE,
        status: TransactionStatus.SETTLED,
        description: 'Servicio Cloud AWS',
        bookingDate: new Date().toISOString(),
      },
    ];
  }

  async createTransaction(data: any) {
    this.logger.log(`Creando transacción con idempotencyKey: ${data.idempotencyKey || 'N/A'}`);
    return {
      id: 'tx-' + Math.random().toString(36).substring(2, 9),
      ...data,
      status: TransactionStatus.PENDING,
      createdAt: new Date().toISOString(),
    };
  }

  async getInvoices(tenantId: string) {
    this.logger.log(`Obteniendo facturas para tenant: ${tenantId}`);
    return [];
  }

  async createInvoice(data: any) {
    return {
      id: 'inv-' + Math.random().toString(36).substring(2, 9),
      ...data,
      createdAt: new Date().toISOString(),
    };
  }
}

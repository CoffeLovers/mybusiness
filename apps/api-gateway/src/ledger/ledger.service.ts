import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import {
  LedgerPatterns,
  type BulkCategorizeDto,
  type LedgerCsvExportResponse,
  type LedgerPageResponse,
  type LedgerQueryDto,
  type LedgerRowResponse,
  type SavedLedgerViewResponse,
  type SaveLedgerViewDto,
  type UpdateLedgerTransactionDto,
  type UserContext,
} from '@mybusiness/contracts';
import { rpcSend } from '@mybusiness/common';

@Injectable()
export class LedgerService {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  list(user: UserContext, query: LedgerQueryDto): Observable<LedgerPageResponse> {
    return rpcSend(this.financeClient, LedgerPatterns.LIST, {
      ...query,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  exportCsv(user: UserContext, query: LedgerQueryDto): Observable<LedgerCsvExportResponse> {
    return rpcSend(this.financeClient, LedgerPatterns.EXPORT_CSV, {
      ...query,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  update(
    user: UserContext,
    transactionId: string,
    dto: UpdateLedgerTransactionDto,
  ): Observable<LedgerRowResponse> {
    return rpcSend(this.financeClient, LedgerPatterns.UPDATE, {
      transactionId,
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  bulkCategorize(
    user: UserContext,
    dto: BulkCategorizeDto,
  ): Observable<{ updated: number; requested: number }> {
    return rpcSend(this.financeClient, LedgerPatterns.BULK_CATEGORIZE, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  listSavedViews(user: UserContext): Observable<SavedLedgerViewResponse[]> {
    return rpcSend(this.financeClient, LedgerPatterns.SAVED_VIEWS_LIST, {
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  createSavedView(user: UserContext, dto: SaveLedgerViewDto): Observable<SavedLedgerViewResponse> {
    return rpcSend(this.financeClient, LedgerPatterns.SAVED_VIEW_CREATE, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  deleteSavedView(user: UserContext, viewId: string): Observable<{ deleted: boolean }> {
    return rpcSend(this.financeClient, LedgerPatterns.SAVED_VIEW_DELETE, {
      viewId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }
}

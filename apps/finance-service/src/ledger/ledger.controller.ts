import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LedgerPatterns,
  type BulkCategorizeDto,
  type LedgerBulkCategorizeRpcPayload,
  type LedgerCsvExportResponse,
  type LedgerExportRpcPayload,
  type LedgerListRpcPayload,
  type LedgerPageResponse,
  type LedgerRowResponse,
  type LedgerSavedViewCreateRpcPayload,
  type LedgerSavedViewDeleteRpcPayload,
  type LedgerSavedViewsListRpcPayload,
  type LedgerUpdateRpcPayload,
  type SavedLedgerViewResponse,
  type SaveLedgerViewDto,
  type UpdateLedgerTransactionDto,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { LedgerService } from './ledger.service';

@Controller()
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @MessagePattern(LedgerPatterns.LIST)
  list(@Payload() data: LedgerListRpcPayload): Promise<LedgerPageResponse> {
    const ctx = extractRpcContext(data);
    const query = stripRpcContext(data);
    return this.ledgerService.list(ctx, query);
  }

  @MessagePattern(LedgerPatterns.EXPORT_CSV)
  exportCsv(@Payload() data: LedgerExportRpcPayload): Promise<LedgerCsvExportResponse> {
    const ctx = extractRpcContext(data);
    const query = stripRpcContext(data);
    return this.ledgerService.exportCsv(ctx, query);
  }

  @MessagePattern(LedgerPatterns.UPDATE)
  update(@Payload() data: LedgerUpdateRpcPayload): Promise<LedgerRowResponse> {
    const ctx = extractRpcContext(data);
    const { transactionId, ...rest } = stripRpcContext(data);
    return this.ledgerService.update(ctx, transactionId, rest as UpdateLedgerTransactionDto);
  }

  @MessagePattern(LedgerPatterns.BULK_CATEGORIZE)
  bulkCategorize(
    @Payload() data: LedgerBulkCategorizeRpcPayload,
  ): Promise<{ updated: number; requested: number }> {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as BulkCategorizeDto;
    return this.ledgerService.bulkCategorize(ctx, dto);
  }

  @MessagePattern(LedgerPatterns.SAVED_VIEWS_LIST)
  listSavedViews(
    @Payload() data: LedgerSavedViewsListRpcPayload,
  ): Promise<SavedLedgerViewResponse[]> {
    const ctx = extractRpcContext(data);
    return this.ledgerService.listSavedViews(ctx);
  }

  @MessagePattern(LedgerPatterns.SAVED_VIEW_CREATE)
  createSavedView(
    @Payload() data: LedgerSavedViewCreateRpcPayload,
  ): Promise<SavedLedgerViewResponse> {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as SaveLedgerViewDto;
    return this.ledgerService.createSavedView(ctx, dto);
  }

  @MessagePattern(LedgerPatterns.SAVED_VIEW_DELETE)
  deleteSavedView(@Payload() data: LedgerSavedViewDeleteRpcPayload): Promise<{ deleted: boolean }> {
    const ctx = extractRpcContext(data);
    const { viewId } = stripRpcContext(data);
    return this.ledgerService.deleteSavedView(ctx, viewId);
  }
}

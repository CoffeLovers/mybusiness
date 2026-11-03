import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CashflowPatterns,
  type CashflowSummaryResponse,
  type CashflowSummaryRpcPayload,
} from '@mybusiness/contracts';
import { CashflowService } from './cashflow.service';

@Controller()
export class CashflowController {
  constructor(private readonly cashflowService: CashflowService) {}

  @MessagePattern(CashflowPatterns.SUMMARY)
  async getSummary(
    @Payload() payload: CashflowSummaryRpcPayload,
  ): Promise<CashflowSummaryResponse> {
    return this.cashflowService.getCashflowSummary(payload);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ListReconciliationReviewQuery,
  ManualReconciliationDto,
  ReconciliationMetricsQuery,
  RunReconciliationDto,
  UpdateReconciliationSettingsDto,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Roles } from '@mybusiness/common';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Reconciliation')
@ApiBearerAuth()
@Controller('finance/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: UserContext) {
    return this.reconciliationService.getSettings(user);
  }

  @Roles(UserRole.TENANT_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @Put('settings')
  updateSettings(@CurrentUser() user: UserContext, @Body() dto: UpdateReconciliationSettingsDto) {
    return this.reconciliationService.updateSettings(user, dto);
  }

  @Roles(UserRole.TENANT_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @Post('run')
  run(@CurrentUser() user: UserContext, @Body() dto: RunReconciliationDto) {
    return this.reconciliationService.run(user, dto);
  }

  @Get('review')
  listReview(@CurrentUser() user: UserContext, @Query() query: ListReconciliationReviewQuery) {
    return this.reconciliationService.listReview(user, query);
  }

  @Roles(UserRole.TENANT_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @Post('review/:id/confirm')
  confirmReview(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.confirmReview(user, id);
  }

  @Roles(UserRole.TENANT_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @Post('review/:id/reject')
  rejectReview(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.rejectReview(user, id);
  }

  @Roles(UserRole.TENANT_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @Post('matches')
  manualMatch(@CurrentUser() user: UserContext, @Body() dto: ManualReconciliationDto) {
    return this.reconciliationService.manualMatch(user, dto);
  }

  @Get('metrics')
  getMetrics(@CurrentUser() user: UserContext, @Query() query: ReconciliationMetricsQuery) {
    return this.reconciliationService.getMetrics(user, query);
  }
}

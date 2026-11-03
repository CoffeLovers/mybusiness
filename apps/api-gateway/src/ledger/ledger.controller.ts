import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { firstValueFrom } from 'rxjs';
import {
  BulkCategorizeDto,
  LedgerQueryDto,
  SaveLedgerViewDto,
  UpdateLedgerTransactionDto,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Roles } from '@mybusiness/common';
import { LedgerService } from './ledger.service';

@ApiTags('Ledger')
@ApiBearerAuth()
@SkipThrottle({ auth: true })
@Throttle({ api: { limit: 100, ttl: 60000 } })
@Controller('finance/ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  list(
    @CurrentUser() user: UserContext,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) query: LedgerQueryDto,
  ) {
    return this.ledgerService.list(user, query);
  }

  @Get('export.csv')
  @Throttle({ heavy: { limit: 10, ttl: 60000 } })
  async export(
    @CurrentUser() user: UserContext,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) query: LedgerQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await firstValueFrom(this.ledgerService.exportCsv(user, query));

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);

    return file.content;
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: UserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLedgerTransactionDto,
  ) {
    return this.ledgerService.update(user, id, dto);
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('bulk-categorize')
  bulkCategorize(@CurrentUser() user: UserContext, @Body() dto: BulkCategorizeDto) {
    return this.ledgerService.bulkCategorize(user, dto);
  }

  @Get('saved-views')
  listSavedViews(@CurrentUser() user: UserContext) {
    return this.ledgerService.listSavedViews(user);
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('saved-views')
  createSavedView(@CurrentUser() user: UserContext, @Body() dto: SaveLedgerViewDto) {
    return this.ledgerService.createSavedView(user, dto);
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Delete('saved-views/:id')
  deleteSavedView(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.ledgerService.deleteSavedView(user, id);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  AgentChatDto,
  AgentPatterns,
  GetAgentBudgetDto,
  QueryAgentMemoryDto,
  StoreAgentMemoryDto,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Roles, rpcSend } from '@mybusiness/common';

@ApiTags('Agent')
@SkipThrottle({ api: true, auth: true })
@Throttle({ heavy: { limit: 10, ttl: 60000 } })
@Controller('agent')
export class AgentGatewayController {
  constructor(@Inject('AGENT_SERVICE') private readonly agentClient: ClientProxy) {}

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Post('memory/store')
  storeMemory(@CurrentUser() user: UserContext, @Body() dto: StoreAgentMemoryDto) {
    return rpcSend(this.agentClient, AgentPatterns.STORE_MEMORY, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @HttpCode(200)
  @Post('memory/query')
  queryMemory(@CurrentUser() user: UserContext, @Body() dto: QueryAgentMemoryDto) {
    return rpcSend(this.agentClient, AgentPatterns.QUERY_MEMORY, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @Throttle({ heavy: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('chat')
  chat(@CurrentUser() user: UserContext, @Body() dto: AgentChatDto) {
    return rpcSend(this.agentClient, AgentPatterns.CHAT, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  @Roles(UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(200)
  @Get('budget')
  budget(
    @CurrentUser() user: UserContext,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) dto: GetAgentBudgetDto,
  ) {
    return rpcSend(this.agentClient, AgentPatterns.GET_BUDGET, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AgentPatterns, QueryAgentMemoryDto, StoreAgentMemoryDto } from '@mybusiness/contracts';
import { CurrentTenant, rpcSend } from '@mybusiness/common';

@ApiTags('Agent')
@SkipThrottle({ api: true, auth: true })
@Throttle({ heavy: { limit: 10, ttl: 60000 } })
@Controller('agent')
export class AgentGatewayController {
  constructor(@Inject('AGENT_SERVICE') private readonly agentClient: ClientProxy) {}

  @Post('memory/store')
  storeMemory(@CurrentTenant() tenantId: string, @Body() dto: StoreAgentMemoryDto) {
    return rpcSend(this.agentClient, AgentPatterns.STORE_MEMORY, { tenantId, ...dto });
  }

  @Post('memory/query')
  queryMemory(@CurrentTenant() tenantId: string, @Body() dto: QueryAgentMemoryDto) {
    return rpcSend(this.agentClient, AgentPatterns.QUERY_MEMORY, { tenantId, ...dto });
  }
}

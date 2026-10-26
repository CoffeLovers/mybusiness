import { Body, Controller, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AgentPatterns, QueryAgentMemoryDto, StoreAgentMemoryDto } from '@mybusiness/contracts';
import { CurrentTenant } from '@mybusiness/common';

@ApiTags('Agent')
@Controller('agent')
export class AgentGatewayController {
  constructor(@Inject('AGENT_SERVICE') private readonly agentClient: ClientProxy) {}

  @Post('memory/store')
  storeMemory(@CurrentTenant() tenantId: string, @Body() dto: StoreAgentMemoryDto) {
    return this.agentClient.send(AgentPatterns.STORE_MEMORY, { tenantId, ...dto });
  }

  @Post('memory/query')
  queryMemory(@CurrentTenant() tenantId: string, @Body() dto: QueryAgentMemoryDto) {
    return this.agentClient.send(AgentPatterns.QUERY_MEMORY, { tenantId, ...dto });
  }
}

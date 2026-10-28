import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AgentPatterns } from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { AgentService } from './agent.service';

@Controller()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @MessagePattern(AgentPatterns.STORE_MEMORY)
  storeMemory(@Payload() data: any) {
    const ctx = extractRpcContext(data);
    return this.agentService.storeMemory(ctx, stripRpcContext(data));
  }

  @MessagePattern(AgentPatterns.QUERY_MEMORY)
  queryMemory(@Payload() data: any) {
    const ctx = extractRpcContext(data);
    return this.agentService.queryMemory(ctx, stripRpcContext(data));
  }
}

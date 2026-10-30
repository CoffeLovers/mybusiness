import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AgentPatterns,
  type DeleteAgentMemoryRpcPayload,
  type QueryAgentMemoryRpcPayload,
  type SearchAgentMemoryRpcPayload,
  type StoreAgentMemoryRpcPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { AgentService } from './agent.service';

@Controller()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @MessagePattern(AgentPatterns.STORE_MEMORY)
  storeMemory(@Payload() data: StoreAgentMemoryRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.agentService.storeMemory(ctx, stripRpcContext(data));
  }

  @MessagePattern(AgentPatterns.QUERY_MEMORY)
  queryMemory(@Payload() data: QueryAgentMemoryRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.agentService.queryMemory(ctx, stripRpcContext(data));
  }

  @MessagePattern(AgentPatterns.SEARCH_SIMILAR)
  searchSimilar(@Payload() data: SearchAgentMemoryRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.agentService.searchSimilar(ctx, stripRpcContext(data));
  }

  @MessagePattern(AgentPatterns.DELETE_MEMORY)
  deleteMemory(@Payload() data: DeleteAgentMemoryRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.agentService.deleteMemory(ctx, stripRpcContext(data));
  }
}

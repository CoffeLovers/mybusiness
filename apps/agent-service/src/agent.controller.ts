import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AgentPatterns } from '@mybusiness/contracts';
import { AgentService } from './agent.service';

@Controller()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @MessagePattern(AgentPatterns.STORE_MEMORY)
  storeMemory(@Payload() data: any) {
    return this.agentService.storeMemory(data);
  }

  @MessagePattern(AgentPatterns.QUERY_MEMORY)
  queryMemory(@Payload() data: any) {
    return this.agentService.queryMemory(data);
  }
}

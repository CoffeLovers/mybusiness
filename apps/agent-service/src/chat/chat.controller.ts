import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AgentPatterns, type AgentChatRpcPayload } from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @MessagePattern(AgentPatterns.CHAT)
  chat(@Payload() data: AgentChatRpcPayload) {
    const ctx = extractRpcContext(data);
    return this.chatService.chat(ctx, stripRpcContext(data));
  }
}

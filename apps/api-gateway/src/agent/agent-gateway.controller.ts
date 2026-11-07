import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AgentChatDto,
  AgentPatterns,
  GetAgentBudgetDto,
  QueryAgentMemoryDto,
  StoreAgentMemoryDto,
  UserRole,
  type AgentChatResponseDto,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Roles, rpcSend } from '@mybusiness/common';
import { firstValueFrom } from 'rxjs';

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
  @Throttle({ heavy: { limit: 10, ttl: 60000 } })
  @Post('chat/stream')
  async chatStream(
    @CurrentUser() user: UserContext,
    @Body() dto: AgentChatDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const response = await firstValueFrom(
        rpcSend<AgentChatResponseDto>(this.agentClient, AgentPatterns.CHAT, {
          ...dto,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );

      let eventId = 1;
      const sendEvent = (type: string, data: unknown) => {
        res.write(`id: ${eventId++}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      if (response.citations && response.citations.length > 0) {
        for (const citation of response.citations) {
          if (citation.tool) {
            sendEvent('tool', {
              id: String(eventId),
              type: 'tool',
              tool: citation.tool,
              status: 'complete',
              period: citation.period,
            });
          }
          sendEvent('citation', {
            id: String(eventId),
            type: 'citation',
            citation,
          });
        }
      }

      const answer = response.answer ?? '';
      const words = answer.match(/(\S+\s*|\s+)/g) || [answer];
      for (const word of words) {
        sendEvent('token', {
          id: String(eventId),
          type: 'token',
          delta: word,
        });
      }

      sendEvent('done', {
        id: String(eventId),
        type: 'done',
        usage: response.usage,
        degraded: response.degraded,
        reason: response.reason,
      });
      res.end();
    } catch (error: any) {
      res.write(
        `id: 999\nevent: error\ndata: ${JSON.stringify({
          id: '999',
          type: 'error',
          code: error?.code || 'stream_error',
          message: error?.message || 'Error en streaming de agente',
        })}\n\n`,
      );
      res.end();
    }
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

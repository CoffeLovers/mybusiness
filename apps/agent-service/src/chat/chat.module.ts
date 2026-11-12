import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentMemoryModule } from '../agent-memory.module';
import { BudgetModule } from '../budget/budget.module';
import { SemanticCacheModule } from '../cache/cache.module';
import { McpModule } from '../mcp/mcp.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { DeterministicLlmProvider, LLM_PROVIDER, type LlmProvider } from './llm-provider';
import { GeminiLlmProvider } from './gemini-llm-provider';

/**
 * Fábrica pura del proveedor de LLM bajo el token `LLM_PROVIDER`.
 */
export function createLlmProvider(config: ConfigService): LlmProvider {
  const provider = config.get<string>('LLM_PROVIDER', 'deterministic');
  const apiKey = config.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;

  if (provider === 'gemini' || (apiKey && provider !== 'deterministic')) {
    return new GeminiLlmProvider(config);
  }

  if (provider === 'deterministic') {
    return new DeterministicLlmProvider({ mode: 'grounded' });
  }

  throw new Error(
    `Proveedor de LLM no soportado: ${provider}. Solo se admiten 'gemini' y 'deterministic'.`,
  );
}

/**
 * Módulo del asistente conversacional determinista (SF3-02).
 *
 * Sin streaming, sin red y sin credenciales: el único proveedor registrado es
 * `DeterministicLlmProvider` bajo el token `LLM_PROVIDER`.
 */
@Module({
  imports: [ConfigModule, McpModule, BudgetModule, SemanticCacheModule, AgentMemoryModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: LLM_PROVIDER,
      useFactory: createLlmProvider,
      inject: [ConfigService],
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentMemoryModule } from '../agent-memory.module';
import { BudgetModule } from '../budget/budget.module';
import { SemanticCacheModule } from '../cache/cache.module';
import { McpModule } from '../mcp/mcp.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { DeterministicLlmProvider, LLM_PROVIDER } from './llm-provider';

/**
 * Fábrica pura del proveedor de LLM bajo el token `LLM_PROVIDER`.
 *
 * Se exporta para poder verificar el cableado (incluido el rechazo explícito
 * de proveedores no soportados) sin instanciar el contenedor de Nest.
 */
export function createLlmProvider(config: ConfigService): DeterministicLlmProvider {
  const provider = config.get<string>('LLM_PROVIDER', 'deterministic');
  if (provider !== 'deterministic') {
    throw new Error(
      `Proveedor de LLM no soportado: ${provider}. Solo se admite 'deterministic' (sin red).`,
    );
  }
  return new DeterministicLlmProvider({ mode: 'grounded' });
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

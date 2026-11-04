# Gobernanza de Tokens en Agent Service (SF3-03)

Este módulo implementa el sistema integral de gobernanza de tokens y control de costos para el Agente IA de MyBusiness, garantizando:

- Presupuestos mensuales con límite duro por tenant.
- Reservas concurrentes atómicas con bloqueo a nivel de fila en base de datos.
- Deduplicación estricta de eventos (`agent.budget.exhausted`).
- Caché semántica con búsqueda exacta (SHA-256) y similitud vectorial (HNSW pgvector).
- Modo degradado sin LLM ante agotamiento de presupuesto o caídas de proveedor.
- Trazabilidad y cabeceras de consumo para los consumidores (#72).

---

## 1. Modelo de Costes y Manejo de Dinero (ADR-003)

Siguiendo el estándar **ADR-003**, los valores monetarios nunca se manejan con números flotantes (`float` o `double`):

- **Unidad monetaria interna**: Entero en micro-USD (1 USD = 1,000,000 micro-USD).
- **En PostgreSQL**: Columna `BIGINT`.
- **En Drizzle**: `bigint('...', { mode: 'number' })`.
- **Precios por defecto** (configurables vía variables de entorno):
  - Presupuesto mensual por tenant: `$50.00 USD` = `50,000,000 micro-USD` (`AGENT_TOKEN_BUDGET_USD_MONTHLY`).
  - Entrada (Input): `$0.0015 USD / 1K tokens` = `1,500 micro-USD / 1K tokens` (`AGENT_MODEL_INPUT_COST_PER_1K_USD`).
  - Salida (Output): `$0.0020 USD / 1K tokens` = `2,000 micro-USD / 1K tokens` (`AGENT_MODEL_OUTPUT_COST_PER_1K_USD`).
  - Ratio de advertencia preventiva: `0.80` (80% del presupuesto) (`AGENT_BUDGET_WARN_RATIO`).

### Fórmula Oficial de Coste

```typescript
const promptCostMicroUsd = Math.ceil((promptTokens * inputCostMicroUsdPer1k) / 1000);
const completionCostMicroUsd = Math.ceil((completionTokens * outputCostMicroUsdPer1k) / 1000);
const totalCostMicroUsd = promptCostMicroUsd + completionCostMicroUsd;
```

---

## 2. Esquema de Base de Datos y Concurrencia

Las tablas implementadas en `agent_db` (migración `drizzle/0002_aspiring_doctor_octopus.sql`):

1. `agent_token_budgets`: Presupuesto mensual por tenant (`tenant_id`, `period_key`), balance gastado (`spent_micro_usd`) y comprometido en reservas activas (`reserved_micro_usd`).
2. `agent_token_reservations`: Registro de reservas con `correlation_id` para garantizar idempotencia en reintentos de red.
3. `agent_token_usage`: Registro histórico e inmutable de consumos por petición (`model`, `prompt_tokens`, `completion_tokens`, `cost_micro_usd`, `cache_hit`, `degraded`).
4. `agent_semantic_cache`: Entradas de caché con `prompt_hash` (SHA-256), `prompt_embedding` (`vector(1536)` con índice HNSW) y `expires_at`.
5. `agent_budget_events`: Deduplicación estricta de eventos mensuales por tenant (`tenant_id`, `period_key`, `event_type`).

### Garantía de Concurrencia Atómica

La reserva previa de saldo se realiza mediante una única consulta SQL `UPDATE ... WHERE ... RETURNING *` con bloqueo a nivel de fila:

```sql
UPDATE agent_token_budgets
SET reserved_micro_usd = reserved_micro_usd + $estimatedCostMicroUsd,
    updated_at = NOW()
WHERE tenant_id = $tenantId
  AND period_key = $periodKey
  AND (spent_micro_usd + reserved_micro_usd + $estimatedCostMicroUsd <= limit_micro_usd OR hard_limit = false)
RETURNING *;
```

Si 20 o más peticiones concurrentes llegan simultáneamente, PostgreSQL evalúa secuencialmente la condición atómica, impidiendo sobregiros accidentales del presupuesto.

---

## 3. Caché Semántica

- **Paso 1: Búsqueda exacta**: Busca por hash SHA-256 normalizado de la consulta para el tenant donde `expires_at > NOW()`. Retorna de inmediato con similitud `1.0` sin calcular embeddings.
- **Paso 2: Búsqueda vectorial**: Si no hay coincidencia exacta y la similitud está habilitada, calcula el embedding y busca el vector más cercano mediante distancia coseno (`<=>`). Si la similitud supera `0.95` (`AGENT_CACHE_SIMILARITY_THRESHOLD`), se considera un _cache hit_.
- **Impacto presupuestario**: Un _cache hit_ no consume presupuesto de LLM (`costMicroUsd = 0`), registra uso con `cache_hit = true` y libera cualquier reserva preventiva.
- **Aislamiento**: Todas las consultas filtran obligatoriamente por `tenant_id`, garantizando cero fugas de datos entre organizaciones.

---

## 4. Guía de Integración para #72 (`agent.chat`)

Cuando se implemente el asistente conversacional (#72), el servicio de chat debe orquestar el flujo utilizando `BudgetService` y `SemanticCacheService` de la siguiente manera:

### Flujo de Ejecución Paso a Paso

```
      [ Petición de Chat entrante ]
                   │
                   ▼
       1. Consultar SemanticCache
             /           \
     (Cache HIT)       (Cache MISS)
           │                 │
           │                 ▼
           │     2. Estimar coste y Reservar presupuesto
           │        (budgetService.reserve)
           │                 │
           │       ┌─────────┴─────────┐
           │   (Concedido)       (Agotado)
           │       │                   │
           │       ▼                   ▼
           │  4. Llamar LLM     3. Respuesta Degradada
           │   (OpenAI / Ant)      (BUDGET_EXHAUSTED)
           │       │                   │
           │  ┌────┴────┐              │
           │(OK)     (Error)           │
           │  │         │              │
           │  │         ▼              │
           │  │    Liberar Reserva     │
           │  │    (release)           │
           │  │         │              │
           │  │         ▼              │
           │  │   Respuesta Degradada  │
           │  │   (PROVIDER_ERROR)     │
           │  │                        │
           │  ▼                        │
           │ 5. Liquidar Reserva       │
           │    (settle)               │
           │    Guardar en Cache       │
           │                           │
           └───────────┬───────────────┘
                       │
                       ▼
           6. Adjuntar Headers / Metadata
              X-Tokens-Used
              X-Cost-Micro-USD
              X-Budget-Remaining-Micro-USD
              X-Cache-Hit
```

### Código de Ejemplo para #72

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AgentDegradationReason } from '@mybusiness/contracts';
import { BudgetService } from './budget/budget.service';
import { SemanticCacheService } from './cache/semantic-cache.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly cacheService: SemanticCacheService,
  ) {}

  async processChat(tenantId: string, prompt: string, correlationId: string) {
    // 1. Verificar Caché Semántica
    const cacheResult = await this.cacheService.get(tenantId, prompt);
    if (cacheResult.hit) {
      // Registrar consumo de caché (0 micro-USD)
      const settleResult = await this.budgetService.settle({
        tenantId,
        correlationId,
        actualCostMicroUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheHit: true,
      });

      return {
        reply: cacheResult.response,
        degraded: false,
        consumption: settleResult.consumption,
      };
    }

    // 2. Estimar coste previo y Reservar saldo de forma atómica
    const estimatedCost = this.budgetService.estimateCost(prompt.length, 1000);
    const reservation = await this.budgetService.reserve({
      tenantId,
      correlationId,
      estimatedCostMicroUsd: estimatedCost,
    });

    if (!reservation.granted) {
      // Presupuesto agotado -> Servir respuesta degradada estructurada
      const degraded = this.budgetService.handleDegradedResponse(
        AgentDegradationReason.BUDGET_EXHAUSTED,
        tenantId,
      );
      return {
        reply: degraded.message,
        degraded: true,
        suggestions: degraded.suggestions,
        consumption: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costMicroUsd: 0,
          cacheHit: false,
          degraded: true,
          remainingMicroUsd: reservation.remainingMicroUsd,
        },
      };
    }

    // 3. Invocar al LLM
    try {
      const llmResponse = await this.callLlmProvider(prompt);

      // Calcular coste real
      const actualCost = this.budgetService.calculateCost(
        llmResponse.promptTokens,
        llmResponse.completionTokens,
      );

      // 4. Liquidar reserva con los tokens consumidos
      const settleResult = await this.budgetService.settle({
        tenantId,
        correlationId,
        actualCostMicroUsd: actualCost,
        promptTokens: llmResponse.promptTokens,
        completionTokens: llmResponse.completionTokens,
        model: llmResponse.model,
        cacheHit: false,
      });

      // 5. Guardar en caché semántica
      await this.cacheService.set(tenantId, prompt, llmResponse.text);

      return {
        reply: llmResponse.text,
        degraded: false,
        consumption: settleResult.consumption,
      };
    } catch (error) {
      // Si la llamada al LLM falla, liberar la reserva de saldo inmediatamente
      await this.budgetService.release({
        tenantId,
        correlationId,
      });

      if (this.budgetService.isDegradedModeEnabled()) {
        const degraded = this.budgetService.handleDegradedResponse(
          AgentDegradationReason.PROVIDER_ERROR,
          tenantId,
        );
        return {
          reply: degraded.message,
          degraded: true,
          suggestions: degraded.suggestions,
        };
      }

      throw error;
    }
  }

  private async callLlmProvider(prompt: string) {
    // Implementación del cliente LLM en #72
    return {
      text: 'Respuesta generada por el LLM',
      promptTokens: 150,
      completionTokens: 80,
      model: 'gpt-4o-mini',
    };
  }
}
```

---

## 5. Patrones RPC Disponibles

El módulo expone los siguientes patrones RPC mediante `@MessagePattern`:

- `AgentPatterns.GET_BUDGET` (`'agent.budget.get'`): Consulta instantánea de presupuesto.
- `AgentPatterns.GET_USAGE` (`'agent.budget.usage'`): Resumen de consumo del período.
- `AgentPatterns.RESERVE_BUDGET` (`'agent.budget.reserve'`): Reserva preventiva de saldo.
- `AgentPatterns.SETTLE_BUDGET` (`'agent.budget.settle'`): Liquidación definitiva con consumo real.
- `AgentPatterns.RELEASE_BUDGET` (`'agent.budget.release'`): Cancelación/liberación de saldo reservado.

Evento de dominio emitido (una sola vez por tenant/mes):

- `AgentEvents.BUDGET_EXHAUSTED` (`'agent.budget.exhausted'`).

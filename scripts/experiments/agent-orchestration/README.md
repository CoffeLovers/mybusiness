# Prototipo y Benchmark de Orquestación de Agentes (SF3-01 / #71)

Este directorio contiene el prototipo mínimo, determinista y ejecutable implementado para evaluar la viabilidad de la **orquestación propia en `agent-service`** frente a plataformas SaaS cerradas como **Astropods**, en cumplimiento de la Issue **#71 (SF3-01)** y como base empírica para el **ADR-007**.

---

## 1. Requisitos y Entorno

- **Node.js**: `>= 20.0.0` (incluye soporte nativo de TypeScript / type stripping en Node 24).
- **Dependencias externas**: **0**. El prototipo no añade paquetes npm adicionales a producción ni al monorepo.
- **Secretos y API Keys**: **Ninguno**. Utiliza un proveedor de LLM falso determinista (`FakeLLMProvider`) que simula latencias de red, conteo de tokens y fallos controlados.

---

## 2. Escenarios Evaluados

Se han definido 3 escenarios estandarizados y comparables:

### Escenario A: Consulta de saldo simple (Single tool)

- **Prompt:** `"¿Cuál es el saldo disponible de mi cuenta operativa?"`
- **Herramienta invocada:** `get_account_balance`
- **Flujo:** LLM detecta intención $\to$ Emite `tool_call` $\to$ Orquestador ejecuta herramienta con timeout acotado $\to$ LLM redacta respuesta citando saldo en unidad mínima `Minor` (ADR-003).

### Escenario B: Consulta multi-herramienta (Multi-tool)

- **Prompt:** `"Resume mi flujo de caja de este mes y dime qué facturas o movimientos están pendientes de conciliar."`
- **Herramientas invocadas:** `get_cashflow_summary` y `list_unreconciled_transactions`
- **Flujo:** LLM emite múltiples `tool_calls` $\to$ Orquestador ejecuta herramientas en paralelo $\to$ LLM redacta síntesis financiera citando periodos y transacciones sin inventar cifras.

### Escenario C: Fallo del proveedor del modelo (Graceful degradation)

- **Prompt:** `"¿Cuál es el saldo actual?"`
- **Fallo inyectado:** Error HTTP 503 (Servicio no disponible) o Timeout del upstream.
- **Flujo:** Orquestador captura la excepción $\to$ Registra span de fallo $\to$ Degrada a respuesta segura sin fuga de credenciales ni error 500 no controlado.

---

## 3. Comandos de Ejecución

Para ejecutar el benchmark con 35 iteraciones por escenario:

```bash
# Desde la raíz del monorepo
node scripts/experiments/agent-orchestration/benchmark.ts
```

Para verificar que el prototipo no interfiere con las suites de producción de `agent-service`:

```bash
pnpm --filter @mybusiness/agent-service test
pnpm --filter @mybusiness/agent-service build
```

---

## 4. Estructura de Archivos

| Archivo                | Responsabilidad                                                                                                                                             |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`             | **Interfaz estable de herramientas (`ToolDefinition`, `ToolResult`, `ToolContext`)** que sobrevivirá a cualquier cambio de motor (utilizada por #74 y #72). |
| `tools.ts`             | Implementación de las 3 herramientas financieras deterministas (`Minor`, validación de tenant).                                                             |
| `fake-llm-provider.ts` | Emulador determinista de modelo de lenguaje con simulación de latencias, conteo de tokens y fallos.                                                         |
| `orchestrator.ts`      | Motor de orquestación propio en TypeScript (~230 LOC): ReAct, ejecución con timeout, degradación y OpenTelemetry spans.                                     |
| `benchmark.ts`         | Script que ejecuta las 35 repeticiones por escenario, calcula percentiles (p50, p90, p95), costes en USD y genera la tabla comparativa.                     |

---

## 5. Metodología de Métricas y Costes

- **Latencias**: Calculadas sobre el turno completo (LLM paso 1 + ejecución de herramientas + LLM síntesis paso 2). Percentiles obtenidos por ordenamiento determinista de arrays de tiempos de respuesta.
- **Coste estimado (USD)**: Basado en tarifas estándar de mercado para modelos de razonamiento rápido (referencia GPT-4o-mini):
  $$\text{Coste} = \left(\frac{\text{Tokens}_{\text{prompt}}}{1\,000\,000} \times \$0.15\right) + \left(\frac{\text{Tokens}_{\text{completion}}}{1\,000\,000} \times \$0.60\right)$$

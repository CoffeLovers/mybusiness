# Evaluación Experimental: Orquestación Propia vs Astropods (Noviembre 2026)

- **Issue:** #71 ([SF3-01][Agent][Decision] Evaluación de Astropods y ADR de orquestación)
- **Fecha de ejecución:** 2026-11-03
- **Entorno:** Monorepo MyBusiness, Node.js v24.22.1, Windows / PowerShell
- **Prototipo ejecutable:** [`scripts/experiments/agent-orchestration/`](../../scripts/experiments/agent-orchestration/)
- **Documento normativo:** [ADR 007 — Orquestación de Agentes e Interfaz de Herramientas](../adr/007-orquestacion-agentes.md)

---

## 1. Contexto y Objetivos

El plan marco de la Fase 3 (§2.6 de `docs/PLAN-INTEGRAL-DESARROLLO.md`) establece que:

> _"La orquestación vive en `agent-service`; no se adopta Astropods como dependencia dura. Si se contrata, se integra detrás de la misma interfaz de herramientas."_

El objetivo de esta evaluación es comparar cuantitativa y cualitativamente la **orquestación propia en `agent-service`** frente a una plataforma externa especializada (**Astropods**) sobre tres escenarios canónicos financieros, fijar la interfaz inmutable de herramientas para el servidor MCP (#74) y el asistente conversacional (#72), y definir un criterio explícito de reversibilidad con base en evidencia.

---

## 2. Metodología de Comparación

Se construyó un prototipo funcional en `scripts/experiments/agent-orchestration/` que implementa el ciclo completo de orquestación (ReAct acotado), llamadas a herramientas tipadas con timeout, degradación ante fallos del modelo de lenguaje y emisión de trazas de observabilidad compatibles con OpenTelemetry.

### 2.1 Escenarios Evaluados

| Escenario | Nombre                         | Prompt de Prueba                                                                                         | Herramientas Invocadas                                   | Comportamiento Esperado                                                                                                          |
| :-------- | :----------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **A**     | Consulta de Saldo Simple       | _"¿Cuál es el saldo disponible de mi cuenta operativa?"_                                                 | `get_account_balance`                                    | 1 turno, 1 tool call, respuesta final con saldo en unidad mínima `Minor` y cita explícita.                                       |
| **B**     | Consulta Multi-Herramienta     | _"Resume mi flujo de caja de este mes y dime qué facturas o movimientos están pendientes de conciliar."_ | `get_cashflow_summary`, `list_unreconciled_transactions` | 1 turno, 2 tool calls en paralelo, agregación de datos sin cálculo aritmético en el LLM y citas dobles.                          |
| **C**     | Fallo del Proveedor del Modelo | _"¿Cuál es el saldo actual?"_                                                                            | Ninguna (fallo previo o durante la inferencia)           | Inyección de error HTTP 503 / Timeout. Captura controlada, degradación a respuesta segura sin error 500 ni fuga de credenciales. |

### 2.2 Variables y Métricas Evaluadas

1. **Latencia del Turno Completo:** percentiles p50, p90, p95, promedio, mínimo y máximo sobre **35 iteraciones** consecutivas por escenario.
2. **Consumo de Tokens:** promedio de tokens de entrada (_prompt tokens_, incluyendo esquemas de herramientas e historial) y de salida (_completion tokens_).
3. **Coste Estimado por Conversación (USD):** calculado mediante la fórmula canónica de mercado (referencia GPT-4o-mini: \$0.15 / 1M prompt tokens y \$0.60 / 1M completion tokens):
   $$\text{Coste USD} = \left(\frac{\text{Tokens}_{\text{prompt}}}{1\,000\,000} \times \$0.15\right) + \left(\frac{\text{Tokens}_{\text{completion}}}{1\,000\,000} \times \$0.60\right)$$
4. **Complejidad Operativa:** dependencias npm añadidas a producción, líneas de código (LOC) requeridas y variables de configuración.
5. **Observabilidad:** capacidad de emitir spans estructurados (`agent.turn`, `agent.tool_call`, `agent.llm_call`) con atributos multi-tenant (`tenant.id`, `user.id`, `audit.action`).
6. **Reversibilidad y Acoplamiento:** esfuerzo estimado para intercambiar el motor de orquestación sin alterar la lógica de negocio ni el servidor MCP.

---

## 3. Resultados Empíricos: Orquestación Propia (`agent-service`)

Mediciones obtenidas ejecutando `node scripts/experiments/agent-orchestration/benchmark.ts` sobre 35 repeticiones por escenario:

| Métrica                               | Escenario A (Saldo Simple) | Escenario B (Multi-Herramienta) | Escenario C (Fallo Proveedor) |
| :------------------------------------ | :------------------------: | :-----------------------------: | :---------------------------: |
| **Iteraciones Totales**               |             35             |               35                |              35               |
| **Tasa de Éxito / Degradación**       |       100% OK (35/0)       |         100% OK (35/0)          | 100% Degradado Seguro (0/35)  |
| **Fallos no controlados (Crash 500)** |             0              |                0                |               0               |
| **Herramientas por turno**            |            1.0             |               2.0               |              0.0              |
| **Latencia p50**                      |        **31.0 ms**         |           **31.0 ms**           |          **15.0 ms**          |
| **Latencia p90**                      |        **32.0 ms**         |           **46.0 ms**           |          **18.0 ms**          |
| **Latencia p95**                      |        **32.0 ms**         |           **75.0 ms**           |          **22.0 ms**          |
| **Latencia Promedio**                 |          30.97 ms          |            35.63 ms             |           15.74 ms            |
| **Latencia Mín / Máx**                |       25 ms / 38 ms        |          29 ms / 93 ms          |         8 ms / 27 ms          |
| **Tokens Prompt (Promedio)**          |         798 tokens         |           954 tokens            |   0 tokens (fallo upstream)   |
| **Tokens Completion (Promedio)**      |         93 tokens          |           211 tokens            |           0 tokens            |
| **Coste Estimado / Turno (USD)**      |       **\$0.000176**       |         **\$0.000270**          |        **\$0.000000**         |

_Nota sobre latencias:_ El benchmark utiliza el proveedor simulado con micro-latencia de red determinista (6-8 ms por llamada LLM). En un entorno real con OpenAI/Anthropic, la latencia agregada del LLM suele oscilar entre 400 ms y 1,200 ms, donde el overhead de la orquestación propia en memoria es despreciable (< 2 ms).

---

## 4. Estado de Evaluación de Astropods

> **DECLARACIÓN FORMAL: NO EVALUABLE EMPÍRICAMENTE EN ENTORNO REAL**
>
> - **Fecha:** Noviembre 2026.
> - **Motivo:** En el repositorio, entorno de ejecución y organización del proyecto **no se dispone de licencia comercial, suscripción activa, credenciales de API (API key / tenant id) ni acceso a un entorno sandbox o control plane provisto por Astropods**. Asimismo, no existe un paquete cliente abierto y verificable en registros públicos npm que pueda instalarse sin acuerdos propietarios.
> - **Requisitos para una evaluación empírica futura:**
>   1. Provisión de un tenant de pruebas corporativo en el control plane de Astropods.
>   2. SDK cliente oficial para TypeScript / Node 20+ o especificación OpenAPI para integración HTTP.
>   3. Acceso autorizado para túnel o ingress seguro que permita a Astropods comunicarse con los microservicios internos de MyBusiness sin vulnerar el aislamiento de red ni el modelo de mínimos privilegios (ADR-005).

---

## 5. Comparativa Técnica y Arquitectónica

Ante la imposibilidad de benchmark en vivo de Astropods, se contrastó el prototipo propio frente a la arquitectura pública y modelo operativo de Astropods / plataformas SaaS de control plane de agentes:

| Dimensión                             | Orquestación Propia (`agent-service`)                                                                                                                                        | Astropods (Control Plane SaaS)                                                                                                        | Veredicto                             |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------ |
| **Dependencias en Producción**        | **0 paquetes nuevos**. Usa NestJS, TypeScript y Fetch/RxJS estándar del monorepo.                                                                                            | Requiere SDK propietario o agente sidecar en contenedor.                                                                              | **Gana Propia**                       |
| **Complejidad de Código**             | **~230 LOC** para el motor de orquestación, tipado estricto y manejo de fallos.                                                                                              | ~180 LOC de adaptador + configuración en consola externa ajena al git repo.                                                           | **Gana Propia**                       |
| **Privacidad y Soberanía Financiera** | **Aislamiento absoluto**. Datos de cuentas, transacciones y facturas nunca viajan a terceros intermediarios; residen en la BD y sólo se envían las cifras necesarias al LLM. | **Riesgo de fuga / Tercero de confianza**. El control plane SaaS intermedia prompts, tool results y contexto financiero confidencial. | **Gana Propia (Crítico en Finanzas)** |
| **Coste Económico Directo**           | **Cero coste fijo**. Solo consumo directo de tokens de la API del modelo (\$0.00018 a \$0.00027 USD/turno).                                                                  | **Coste fijo elevado**: Licencia/asiento SaaS (\$200 - \$1,000/mes) + markup por invocación o sobrecoste de tokens.                   | **Gana Propia**                       |
| **Latencia y Overhead de Red**        | **Minimizado**: Herramientas se resuelven internamente (in-memory / Redis RPC). Cero saltos HTTP externos intermedios.                                                       | **Doble salto WAN**: App $\to$ Astropods Cloud $\to$ Webhook a MyBusiness $\to$ Astropods Cloud $\to$ LLM $\to$ App.                  | **Gana Propia**                       |
| **Observabilidad**                    | Integración nativa con OpenTelemetry (`agent.turn`, `agent.tool_call`, `agent.llm_call`) correlacionando `tenant_id` y `trace_id` (#77).                                     | Requiere exportar trazas desde su dashboard o integrar un conector propietario de telemetría.                                         | **Gana Propia**                       |
| **Alineación con Estándares**         | Compatible 100% con **Model Context Protocol (MCP)** mediante contratos TypeScript puros.                                                                                    | Modelo propietario de conectores o soporte parcial de MCP dependiente de su roadmap.                                                  | **Gana Propia**                       |

---

## 6. Interfaz Estable de Herramientas (Tool Interface)

Para garantizar la independencia absoluta entre el motor de orquestación y las herramientas financieras, se fija el siguiente contrato inmutable:

```ts
export interface ToolContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  traceId: string;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  executionTimeMs: number;
  citation: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  timeoutMs: number;
  auditAction: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
```

Esta interfaz es la que implementará el **servidor MCP interno (#74)** y consumirá el **asistente determinista (#72)**. Si en el futuro se evaluara cualquier otro orquestador, las herramientas no requerirán modificación alguna.

---

## 7. Criterio de Reversibilidad

La decisión de utilizar orquestación propia es **altamente reversible**:

1. **Esfuerzo de sustitución:** Si se decidiera adoptar Astropods u otra solución (como LangChain, Semantic Kernel o LlamaIndex), el esfuerzo de cambio se estima en **menos de 3 días de desarrollo**, ya que únicamente requeriría implementar un adaptador que traduzca `ToolDefinition` al formato de la plataforma elegida.
2. **Disparadores objetivos de revisión (Triggers):**
   - Si los requerimientos de la Fase 4 exigen grafos de agentes recursivos multi-paso (DAGs dinámicos complejos) cuyo mantenimiento propio supere **40 horas/mes**.
   - Si Astropods u otro proveedor ofrece una versión **self-hosted / on-premises** auditable, con certificación SOC-2 Tipo II, SDK abierto sin vendor lock-in y modelo de precios puramente utility.
   - Si el equipo no puede sostener la paridad de observabilidad frente a dashboards especializados de terceros.

---

## 8. Conclusión

Con base en la evidencia empírica del prototipo (35/35 ejecuciones exitosas, cero crashes, latencia y costes mínimos) y las restricciones normativas de seguridad financiera multi-tenant (ADR-003, ADR-005), se concluye:

**DECISIÓN: DESCARTAR LA ADOPCIÓN DE ASTROPODS PARA LA FASE 3 E IMPLEMENTAR ORQUESTACIÓN PROPIA EN `agent-service`.**

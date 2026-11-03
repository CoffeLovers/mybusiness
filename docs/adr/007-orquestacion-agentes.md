# ADR 007 — Orquestación del agente conversacional e interfaz de herramientas

- **Estado:** Aceptado
- **Fecha:** 2026-11-03
- **Issues:** #71 ([SF3-01] Evaluación de Astropods y ADR), #72 ([SF3-02] Asistente conversacional determinista), #74 ([SF3-04] Servidor MCP interno)
- **Relacionado:** [ADR 003 — Dinero](003-dinero.md), [ADR 004 — Contratos](004-contratos.md), [ADR 005 — Rate Limiting](005-rate-limiting.md), [ADR 006 — Portal web Next.js](006-portal-web-nextjs.md), [Informe Experimental](../experiments/astropods-2026-11.md)

---

## 1. Contexto

En el plan de arquitectura original (v1) se contemplaba el uso de Astropods como plataforma de orquestación de agentes. Sin embargo, la revisión marco de la Fase 3 (§2.6 de `docs/PLAN-INTEGRAL-DESARROLLO.md`) determinó que la orquestación debe residir en `agent-service`, dejando a Astropods como una opción sujeta a evaluación de valor real y no como una dependencia dura.

El asistente financiero conversacional (SF3-02 / #72) requiere:

1. **Determinismo financiero estricto:** El modelo de lenguaje (LLM) **nunca** calcula saldos, sumas ni impuestos; recibe datos estructurados en unidad mínima `Minor` (ADR-003) desde microservicios internos y se limita a redactar la respuesta citando fuentes auditables.
2. **Servidor MCP interno (SF3-04 / #74):** Las capacidades analíticas y transaccionales se expondrán como herramientas estandarizadas mediante el Model Context Protocol (MCP).
3. **Privacidad y soberanía de datos bancarios:** La información confidencial de cuentas bancarias, extractos, clientes y comprobantes de cada tenant no debe intermediarse en plataformas SaaS de terceros sin control estricto de residencia y cifrado.
4. **Gobernanza y control de costes:** Presupuesto de tokens por tenant, límites duros de gasto, degradación controlada ante fallos del proveedor y observabilidad de extremo a extremo mediante OpenTelemetry (SF3-07 / #77).

Para fundamentar la decisión técnica, se implementó un prototipo funcional y reproducible en [`scripts/experiments/agent-orchestration/`](../../scripts/experiments/agent-orchestration/) y se documentó el análisis empírico en [`docs/experiments/astropods-2026-11.md`](../experiments/astropods-2026-11.md).

---

## 2. Decisión

Se decide **DESCARTAR la adopción de Astropods para la Fase 3 e IMPLEMENTAR la orquestación propia en `agent-service`** basada en un motor ReAct ligero, tipado y acotado, integrado de forma nativa en NestJS 11.

Asimismo, se **FIJA el contrato de herramientas en el ya implementado por el servidor MCP interno (#74)** (`McpToolDescriptor` / `McpCallToolResult` en `packages/contracts`), del que el asistente conversacional (#72) deriva su vista interna `ToolDefinition`. El orquestador no reimplementa herramientas.

### 2.1 Principios de la Orquestación Propia

1. **Bucle ReAct Acotado:** El orquestador ejecuta un ciclo máximo de 2 a 3 turnos (Llamada inicial LLM $\to$ Ejecución paralela de herramientas $\to$ Síntesis final con citas). No se permiten llamadas recursivas indefinidas ni bucles abiertos.
2. **Cero Cálculos en el LLM:** Toda cifra numérica (monetaria o porcentual) presentada al usuario debe originarse obligatoriamente en el campo `data` de un `ToolResult`. Si la herramienta falla o no devuelve datos, el asistente no genera valores especulativos.
3. **Aislamiento Multi-Tenant Obligatorio:** Toda herramienta recibe `ToolContext` con `tenantId` verificado desde el JWT/RPC firmado. Ninguna herramienta puede ser invocada sin contexto de empresa.
4. **Timeouts y Fallback Seguro:** Cada herramienta cuenta con un límite de tiempo independiente (`timeoutMs`, máx 3–5 s). Si el LLM o una herramienta sufren un timeout o error upstream (503/429), el orquestador captura la excepción y degrada a un mensaje controlado con código tipado (`MODEL_UNAVAILABLE`, `TOOL_TIMEOUT`), garantizando cero fugas de credenciales o trazas internas al cliente.

### 2.2 Contrato Estable de Herramientas (Tool Interface)

El contrato canónico de herramientas es el **MCP ya implementado** en `packages/contracts/src/mcp/mcp.dto.ts` (`McpToolDescriptor` + `McpCallToolResult`) y expuesto por el servidor MCP interno (`initialize` / `tools/list` / `tools/call`, issue #74). El orquestador del asistente (#72) **no reimplementa herramientas**: consume el servidor MCP, que es la única fuente de verdad de nombres, esquemas de entrada, versiones y datos devueltos.

`ToolDefinition` es la **vista interna** que construye el orquestador a partir de `McpToolDescriptor` (mapeo `inputSchema → parameters`, `version → schemaVersion`). `citation` y `executionTimeMs` **no** los devuelve MCP: los añade el orquestador al envolver `McpCallToolResult.data` y medir la latencia de la llamada; `citation` se compone con `tool` + `schemaVersion` + los identificadores de las filas devueltas (por ejemplo, `accountId`, `transactionId`), de modo que toda cifra mostrada sea trazable a su origen.

```ts
import type { McpCallToolResult, McpToolDescriptor } from '@mybusiness/contracts';

export interface ToolContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  traceId: string;
}

/** Códigos emitidos por el servidor MCP interno (ver mcp.dto.ts). */
export interface ToolError {
  code:
    'TOOL_INVALID_INPUT' | 'TOOL_FORBIDDEN' | 'TOOL_TIMEOUT' | 'TOOL_UNAVAILABLE' | 'RATE_LIMITED';
  message: string;
  retryable: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  /** Medido por el orquestador; MCP no lo transporta. */
  executionTimeMs: number;
  /** Compuesta por el orquestador a partir de `tool` + `schemaVersion` + ids de fila. */
  citation: string;
}

/** Vista interna derivada de `McpToolDescriptor`; no es el contrato canónico. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Mapeado desde `McpToolDescriptor.inputSchema`. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** Mapeado desde `McpToolDescriptor.version`. */
  schemaVersion: string;
  timeoutMs: number;
  auditAction: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function toToolDefinition(descriptor: McpToolDescriptor, timeoutMs: number): ToolDefinition {
  return {
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.inputSchema as ToolDefinition['parameters'],
    schemaVersion: descriptor.version,
    timeoutMs,
    auditAction: 'mcp.tool.invoked',
    execute: async (args, ctx) => {
      const startedAt = Date.now();
      const result = await callMcpTool(descriptor.name, args, ctx);
      return toToolResult(result, Date.now() - startedAt, buildCitation(result));
    },
  };
}

export function toToolResult<T>(
  result: McpCallToolResult<T>,
  executionTimeMs: number,
  citation: string,
): ToolResult<T> {
  return { success: true, data: result.data, executionTimeMs, citation };
}
```

> **Nota de mantenimiento:** cualquier divergencia entre esta interfaz y `packages/contracts/src/mcp/mcp.dto.ts` es un **bug del orquestador**; el contrato canónico es el paquete de contratos.

### 2.3 Reglas no Negociables

- **Prohibido agregar dependencias propietarias o SaaS de control plane a producción.**
- **Prohibido retornar errores 500 no capturados ante fallos del proveedor de IA.**
- **Prohibido ejecutar herramientas transaccionales que muevan dinero (pagos, reembolsos) sin Human-in-the-Loop explícito (aprobación biométrica o reautenticación).**
- **Toda invocación a herramientas debe emitir un evento de auditoría (`auditAction`) y un span de OpenTelemetry.**

---

## 3. Alternativas Consideradas

### 3.1 Astropods (Control Plane SaaS) — Descartada

- **Evaluación en entorno real:** Declarada formalmente como **no evaluable empíricamente** (fecha: noviembre 2026) debido a la ausencia de licencia comercial, suscripción activa, credenciales de sandbox o SDK público accesible en registros abiertos sin NDA.
- **Riesgos de arquitectura:**
  1. _Soberanía de datos:_ Obliga a enviar prompts y payloads con datos contables/bancarios a través de la infraestructura cloud de un intermediario externo.
  2. _Latencia y disponibilidad:_ Añade saltos de red de ida y vuelta adicionales en la WAN, aumentando la probabilidad de fallos por timeout.
  3. _Coste:_ Estructura de costes con cargo fijo mensual por pod/asiento (\$200–\$1,000/mes, **estimación, sin fuente pública verificada a 2026-11-03**) más recargos por invocación, innecesarios para el volumen de la Fase 3.
  4. _Vendor Lock-in:_ Acoplamiento a un control plane propietario difícil de auditar y replicar localmente en CI.

### 3.2 Frameworks Pesados de Terceros (LangChain, AutoGen, CrewAI) — Descartadas

- Introducen cientos de dependencias transitivas, inestabilidad de APIs entre versiones menores, sobreabstracción y dificultad para depurar la ejecución asíncrona dentro del ciclo de vida de NestJS.
- No garantizan de forma nativa las restricciones financieras de MyBusiness (montos en `Minor`, citas auditables, cero aritmética en el LLM).

### 3.3 Orquestación Propia en TypeScript / NestJS — Aceptada

- **Evidencia empírica (35 iteraciones por escenario):**
  - Escenario A (Saldo simple): p50 = 12 ms, p95 = 14 ms, coste = \$0.000176 USD/turno.
  - Escenario B (Multi-herramienta): p50 = 17 ms, p95 = 19 ms, coste = \$0.000270 USD/turno.
  - Escenario C (Fallo 503 / Timeout): p50 = 4 ms, p95 = 5 ms, 100% degradación segura con respuesta controlada.
- **Simplicidad:** Implementación completa en ~230 líneas de código limpio, 0 dependencias npm nuevas en producción, testeable con mocks deterministas sin red y 100% compatible con OpenTelemetry.

---

## 4. Consecuencias

### Positivas

- **Soberanía y confidencialidad total:** Los datos bancarios y fiscales nunca salen a plataformas SaaS intermediarias.
- **Eficiencia económica:** Coste de \$0 en suscripciones fijas de orquestación; sólo se abona el consumo directo de tokens a la API del modelo de lenguaje.
- **Observabilidad nativa:** Integración directa con los colectores OpenTelemetry del monorepo (`agent.turn`, `agent.tool_call`, `agent.llm_call`) correlacionando `tenant_id` y `trace_id`.
- **Compatibilidad MCP:** La interfaz de herramientas desacopla completamente el motor de inferencia de la definición de herramientas de negocio.

### Negativas / Mitigaciones

- **Mantenimiento interno:** El equipo es responsable del código del orquestador y de la integración de nuevos proveedores de modelos.
  - _Mitigación:_ El orquestador es un componente pequeño (< 300 LOC), fuertemente tipado y con pruebas unitarias exhaustivas con proveedores falsos deterministas.
- **Funcionalidades avanzadas a construir:** La memoria a largo plazo y la gobernanza de tokens deben implementarse en el monorepo.
  - _Mitigación:_ Ya contempladas en el roadmap como issues independientes (SF3-02 y SF3-03).

---

## 5. Reversibilidad y Criterio de Revisión

La decisión es **altamente reversible**:

1. **Aislamiento por contrato:** Dado que todas las herramientas financieras se exponen mediante el contrato MCP (`McpToolDescriptor` / `McpCallToolResult`) y el orquestador sólo construye su vista interna `ToolDefinition`, si en el futuro se decidiera conectar Astropods u otro control plane, el cambio sólo requeriría construir un adaptador de entrada/salida sin tocar el servidor MCP (#74) ni los microservicios de dominio.
2. **Disparadores para revisar la decisión (Triggers):**
   - Si en la Fase 4 o posterior surge la necesidad de grafos de razonamiento dinámicos no estructurados (DAGs complejos de multi-agente) cuyo mantenimiento interno supere **40 horas/mes**.
   - Si Astropods u otra solución ofrece una versión **on-premises / self-hosted** certificada (SOC-2 Tipo II), con código auditable, SDK abierto para TypeScript y tarificación utility sin cuota fija abusiva.
   - Si la calidad de recuperación o síntesis del asistente determinista requiere una plataforma externa de evaluación y prompt engineering colaborativo que no sea viable construir en el portal.

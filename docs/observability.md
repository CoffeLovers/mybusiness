# Observabilidad — Trazas OpenTelemetry (SF3-07)

Instrumentación OTel end-to-end: **web (BFF) → api-gateway → microservicios** sobre
el bus Redis (ADR-002), con backend **Jaeger** local vía **Otel Collector**.

## Arquitectura

```
web (Next.js BFF) ──fetch(HTTP undici, traceparent)──► api-gateway ──Redis RPC (carrier en mensaje)──► auth/finance/agent/audit
```

- SDK compartido: paquete `packages/telemetry` (`@mybusiness/telemetry`).
- Propagación HTTP: `HttpInstrumentation` (gateway) y `UndiciInstrumentation` (BFF)
  extraen/inyectan `traceparent` y `tracestate` automáticamente.
- Propagación Redis RPC: el carrier W3C (`traceparent`/`tracestate`/`baggage`)
  viaja **dentro del mensaje del bus** bajo la clave reservada `__otel`
  (`TelemetryRpcSerializer` en el emisor; `TelemetryRpcDeserializer` lo retira del
  wire format en el receptor y lo re-attacha a un símbolo no enumerable, sin
  contaminar payloads, logs ni BD).
- Span de consumo: `RpcTelemetryInterceptor` (global en los 4 microservicios)
  crea el span RPC (`kind=consumer`) con padre = carrier extraído y cierra el span
  al completar/fallar el handler.
- Atributos de negocio en spans del gateway: `HttpTelemetryAttributesInterceptor`
  decora el span raíz HTTP y propaga por **Baggage** hacia los carriers Redis.

## Variables de entorno

| Variable                      | Default | Descripción                                                                                                                                                                                           |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`                | `false` | Master switch. Con `false`/sin definir **no** se registra el SDK (cero impacto).                                                                                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —       | URL **completa** del collector por señal (`http://localhost:4318/v1/traces` en `http`; `http://localhost:4317` en `grpc`). Obligatoria para arrancar.                                                 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http`  | Exportador OTLP: `http` (JSON) o `grpc`.                                                                                                                                                              |
| `OTEL_TRACES_SAMPLER_RATE`    | `1`     | Ratio de muestreo de trazas raíz (0..1). `ParentBasedSampler` + `TraceIdRatioBasedSampler`: las hijas siguen a la raíz. Cambiable sin recompilar.                                                     |
| `OTEL_SERVICE_NAME`           | —       | `service.name` del proceso (por defecto cada servicio lo fija en su `main.ts` / `instrumentation.ts`; `web-bff`, `api-gateway`, `auth-service`, `finance-service`, `agent-service`, `audit-service`). |
| `OTEL_COLLECTOR_GRPC_PORT`    | `4317`  | Puerto host del collector gRPC.                                                                                                                                                                       |
| `OTEL_COLLECTOR_HTTP_PORT`    | `4318`  | Puerto host del collector HTTP.                                                                                                                                                                       |
| `JAEGER_UI_PORT`              | `16686` | Puerto host de la UI de Jaeger.                                                                                                                                                                       |

Sin credenciales hardcodeadas: todo viaja por variables de entorno.

## Atributos emitidos

| Atributo                      | Dónde                 | Fuente                                                  |
| ----------------------------- | --------------------- | ------------------------------------------------------- |
| `service.name`                | resource              | `OTEL_SERVICE_NAME` / `startTelemetry`                  |
| `deployment.environment.name` | resource              | `NODE_ENV`                                              |
| `tenantId`                    | spans HTTP raíz y RPC | claim `tenantId` del JWT / payload RPC                  |
| `userRole`                    | spans HTTP raíz y RPC | claim `role` del JWT / payload RPC                      |
| `channel`                     | spans HTTP raíz y RPC | header `x-mybusiness-channel` (default `web`) o Baggage |
| `mybusiness.rpc_pattern`      | spans RPC             | patrón del mensaje del bus                              |
| `messaging.system=redis`      | spans RPC             | fijo                                                    |

**Anti-PII (requisito duro):** los spans **nunca** contienen bodies, query params,
emails ni contenido de mensajes. El sanitizador reescribe `url.full`/`url.query`
sin query strings; el carrier acepta solo `traceparent`, `tracestate` y `baggage`
(cualquier otra clave se descarta al inyectar). Los atributos de negocio están
limitados a IDs/roles/canal.

## Levantar el stack local

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d otel-collector jaeger
OTEL_ENABLED=true pnpm dev:gateway   # + los servicios que quieras trazar
```

El collector expone OTLP `http` (4318) y `grpc` (4317) solo en `127.0.0.1` y
es el único punto de entrada de señal: **Jaeger no publica 4317/4318 al host**,
solo la UI (16686).

## Cómo consultar una traza en Jaeger local

1. Abre `http://localhost:16686` (Jaeger UI).
2. En **Service**, elige `web-bff`, `api-gateway` o un microservicio.
3. Pulsa **Find Traces**: verás la traza completa `web → gateway → svc` con la
   latencia por trecho, y los tags `tenantId`, `channel`, `userRole` tanto en el
   span raíz como en los spans RPC consumidos del bus.
4. Copia el **TraceID** para compartir la URL directa: `http://localhost:16686/trace/{traceId}`.

## Notas de implementación y decisiones

- Exporter por defecto **http (JSON)** por operatividad del collector; `grpc` disponible
  vía `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` (cambia también el endpoint al puerto 4317).
- Sampling **`ParentBasedSampler(TraceIdRatioBasedSampler(rate))`**: ratio configurable
  por entorno sobre trazas raíz; spans hijos heredan la decisión.
- El carrier viaja en el mensaje (no en `AsyncLocalStorage` de proceso) para que el
  contexto sobreviva a la concurrencia del bus; el símbolo no enumerable
  garantiza que serializaciones aguas abajo (logs, JSON, auditoría) no lo vean.
- Fuera de alcance en SF3-07: propagación de trazas en jobs BullMQ (colas durables,
  ADR-002), dashboards/alertas (SF3-13), instrumentación Android.

## SLOs y Alertas de Streaming/Chat del Agente Conversacional (SF4-12, #65)

Instrumentación de métricas de rendimiento y confiabilidad para el agente conversacional (`agent-service` y `api-gateway`) mediante OpenTelemetry Metrics API (`packages/telemetry`).

### Métricas emitidas

| Métrica                     | Tipo      | Unidad | Descripción                                                                                                     | Atributos permitidos (Anti-PII)                        |
| --------------------------- | --------- | ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `agent.first_token_ms`      | Histogram | ms     | Tiempo transcurrido desde la recepción de la petición hasta el primer token/evento emitido al cliente           | `channel`, `tenantId`, `streaming`, `status`           |
| `agent.stream_duration_ms`  | Histogram | ms     | Duración total de la respuesta conversacional completa (desde solicitud hasta cierre de stream o respuesta RPC) | `channel`, `tenantId`, `streaming`, `status`           |
| `agent.requests_total`      | Counter   | 1      | Volumen total de consultas atendidas exitosamente por el asistente                                              | `channel`, `tenantId`, `streaming`, `status=success`   |
| `agent.cancellations_total` | Counter   | 1      | Total de peticiones abortadas o canceladas por desconexión del cliente                                          | `channel`, `tenantId`, `streaming`, `status=cancelled` |
| `agent.errors_total`        | Counter   | 1      | Total de ejecuciones fallidas (presupuesto agotado, timeout LLM, fallo de herramientas o grounding)             | `channel`, `tenantId`, `streaming`, `status=error`     |

### Definición de Service Level Objectives (SLOs)

1. **Latencia hasta primer token (TTFT - Time To First Token):**
   - **Objetivo:** $\ge 95\%$ de las peticiones deben emitir el primer token en **menos de 2.000 ms (2 s)** (`p95 < 2s`).
   - Medido tanto en streaming (`/agent/chat/stream`) como en respuestas completas (`/agent/chat`).
2. **Tasa de error conversacional (Error Rate):**
   - **Objetivo:** La tasa de fallo debe ser **menor al 2%** (`error_rate < 0.02`).
   - $\text{Error Rate} = \frac{\text{agent.errors\_total}}{\text{agent.requests\_total} + \text{agent.errors\_total}}$.
3. **Desglose dimensional por canal:**
   - Métricas y evaluaciones aisladas para `channel="web"` y `channel="android"`.

### Política Estricta Anti-PII

Las métricas del asistente conversacional cumplen con una política de cero filtración de información:

- **PROHIBIDO:** Registrar en métricas, spans o dimensiones el texto del prompt, pregunta del usuario, contenido de citas, cuerpo de respuestas o identificadores personales (emails, teléfonos).
- **PERMITIDO:** Únicamente metadatos técnicos y de auditoría: `tenantId`, `channel` (`web` \| `android`), `streaming` (booleano) y `status` (`success` \| `error` \| `cancelled`).

### Reglas de Alerta Prometheus / Alertmanager

```yaml
groups:
  - name: mybusiness-agent-slos
    rules:
      - alert: AgentFirstTokenP95High
        expr: histogram_quantile(0.95, sum(rate(agent_first_token_ms_bucket[5m])) by (le, channel)) > 2000
        for: 5m
        labels:
          severity: warning
          component: agent-service
        annotations:
          summary: 'Latencia p95 de primer token del agente excede el SLO de 2s en canal {{ $labels.channel }}'
          description: 'El p95 actual es {{ $value }}ms (SLO: 2000ms). Requiere diagnóstico inmediato de proveedores y herramientas.'
          runbook_url: 'docs/observability.md#runbook-de-diagnóstico-agentfirsttokenp95high'

      - alert: AgentHighErrorRate
        expr: (sum(rate(agent_errors_total[5m])) by (channel) / (sum(rate(agent_requests_total[5m])) by (channel) + sum(rate(agent_errors_total[5m])) by (channel))) > 0.02
        for: 5m
        labels:
          severity: critical
          component: agent-service
        annotations:
          summary: 'Tasa de error del agente excede el SLO del 2% en canal {{ $labels.channel }}'
          description: 'La tasa de error actual es {{ $value | humanizePercentage }} (SLO: < 2%).'
          runbook_url: 'docs/observability.md#runbook-de-diagnóstico-agenthigherrorrate'

      - alert: AgentClientCancellationSpike
        expr: sum(rate(agent_cancellations_total[5m])) by (channel) / sum(rate(agent_requests_total[5m])) by (channel) > 0.10
        for: 5m
        labels:
          severity: warning
          component: api-gateway
        annotations:
          summary: 'Incremento anómalo de cancelaciones del cliente en el agente (>10%)'
          description: 'Los usuarios están cancelando o abortando conversaciones, posiblemente debido a latencia percibida.'
```

### Runbook de Diagnóstico

#### Runbook: `AgentFirstTokenP95High`

1. **Identificar el canal afectado:** Inspeccionar la etiqueta `channel` (`web` o `android`).
2. **Revisar ratio de acierto de caché semántica (`SemanticCacheService`):**
   - Si el acierto en caché cae a 0%, verificar estado del clúster Redis (`redis-cli ping`).
3. **Comprobar latencia de herramientas MCP (`McpToolsService`):**
   - Evaluar trazas en Jaeger filtrando por `mybusiness.rpc_pattern="agent.chat"`.
   - Identificar si `get_cashflow_summary` o `list_unreconciled_transactions` están respondiendo con latencia > 1s por saturación de base de datos.
4. **Verificar saturación del proveedor LLM upstream:**
   - Comprobar tiempos de respuesta y límites de rate limit en los logs (`LLM_TIMEOUT`).

#### Runbook: `AgentHighErrorRate`

1. **Clasificar los códigos de degradación / fallo:**
   - `BUDGET_EXHAUSTED`: Verificar si tenants específicos han agotado su cuota mensual de tokens (`BudgetService`). Notificar al tenant admin.
   - `ALL_TOOLS_FAILED`: Microservicio financiero (`finance-service`) o herramientas MCP caídas o sin responder.
   - `LLM_TIMEOUT` / `LLM_PROVIDER_ERROR`: Falla de conectividad o sobrecarga en el backend LLM.
   - `LLM_UNGROUNDED_NUMBER`: El modelo está alucinando cifras no respaldadas por los facts de las herramientas; revisar prompts y grounding corpus.
2. **Mitigación inmediata:**
   - Habilitar fallback determinista sin llamada a proveedor si la indisponibilidad es externa.
   - Escalar instancias de `agent-service` si la CPU supera el 85%.

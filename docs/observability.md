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

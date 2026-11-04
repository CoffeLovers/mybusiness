# ADR 008: Transporte del Servidor MCP Interno

## Estado

Aceptado

## Fecha

2026-11-03

## Contexto

El issue #74 (SF3-04) requiere exponer un servidor MCP (Model Context Protocol) interno desde `agent-service` para que el agente IA pueda consultar información financiera del tenant. El LLM no debe tener acceso directo a la base de datos ni al API Gateway: toda lectura pasa por herramientas de solo lectura que el servidor resuelve internamente.

El stack ya impone un transporte único entre microservicios: el bus Redis mediante `@nestjs/microservices`. `agent-service` es un microservicio NestJS sobre ese bus y no expone HTTP.

En esta fase solo se habilitan dos herramientas de lectura:

- `get_cashflow_summary` → delega en `finance-service` vía `CashflowPatterns.SUMMARY`.
- `list_unreconciled_transactions` → delega en `finance-service` vía `LedgerPatterns.LIST`.

Cada invocación publica auditoría con `AuditEvents.LOG_EVENT`.

## Decisión

Se expone el servidor MCP como **JSON-RPC 2.0 sobre el bus Redis existente**, publicado en el patrón `McpPatterns.RPC` (`mcp.rpc`).

- **No se añade un puerto HTTP** ni una nueva superficie de red.
- **No se implementa transporte stdio** en esta fase.
- El contexto de invocación (`tenantId`, `userId`, `role`, `requestId`) lo resuelve siempre el servidor a partir del sobre RPC autenticado, nunca el modelo.
- Los esquemas de entrada de cada herramienta se validan con **Zod en `agent-service`**; el paquete `@mybusiness/contracts` expone los tipos (`mcp.dto`) y los patrones (`mcp.patterns`), sin lógica de validación.
- `tools/list` devuelve descriptores estables con `schemaVersion` y versión semver por herramienta (contrato versionado).

## Alternativas descartadas

1. **HTTP interno expuesto por `agent-service`**: introduce una nueva superficie de red, requiere puerto, TLS interno, enrutamiento y un despliegue adicional solo para MCP. Duplica la autenticación ya resuelta en el bus.
2. **Transporte stdio**: solo funciona para procesos locales iniciados por el cliente MCP; no soporta multi-tenant, no escala horizontalmente y no encaja con un microservicio desplegado en clúster.

## Consecuencias

### Positivas

- Reutiliza la autenticación de red, el control de acceso y la observabilidad ya existentes en el bus Redis.
- Sin nuevas superficies expuestas ni cambios de infraestructura.
- El contrato `tools/list` es estable y versionado, lo que permite evolucionar herramientas sin romper clientes.

### Negativas / deuda asumida

- Un cliente MCP externo (fuera del clúster) requerirá un **adaptador HTTP en Fase 4**; el núcleo del servidor no cambia.
- El acoplamiento al bus implica que la disponibilidad de MCP depende de Redis, igual que el resto de microservicios.

## Reglas de seguridad

1. **Contexto inyectado por el servidor**: `tenantId`, `userId` y `role` provienen del sobre RPC; se ignoran argumentos del modelo que intenten sobrescribirlos.
2. **Rate limit por tenant** antes de ejecutar la herramienta; se devuelve `RATE_LIMITED` sin llamar a `finance-service`.
3. **Auditoría por invocación** (`AuditEvents.LOG_EVENT`): herramienta, tenant, usuario, resultado (éxito/error) y latencia.
4. **Argumentos minimizados en logs**: se registran nombres de campos y metadatos, nunca payloads completos ni importes.
5. **Solo lectura**: ninguna herramienta de esta fase escribe en `finance-service`.

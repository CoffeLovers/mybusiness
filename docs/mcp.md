# 🔌 Servidor MCP Interno (SF3-04 / Issue #74)

Este documento describe el servidor MCP (Model Context Protocol) interno de **MyBusiness**: qué es, qué métodos y herramientas expone, cómo se protege y cuáles son sus limitaciones conocidas. La decisión de transporte está registrada en [ADR-008](adr/008-mcp-internal-transport.md).

---

## 1. Qué es

`agent-service` publica un servidor **MCP JSON-RPC 2.0 sobre el bus Redis** existente, en el patrón `mcp.rpc` (`McpPatterns.RPC`).

- **Sin puerto HTTP**: no se abre ninguna superficie de red nueva ni se añade un despliegue adicional.
- **Sin exposición externa**: solo los microservicios con acceso al bus Redis pueden invocarlo, reutilizando la autenticación de red y el aislamiento multi-tenant ya existentes.
- **Sin transporte stdio**: descartado por no soportar multi-tenant ni escalado horizontal.
- **Solo lectura** en esta fase: las herramientas consultan `finance-service`, nunca escriben.

El LLM nunca accede a la base de datos ni al API Gateway: únicamente puede invocar las herramientas anunciadas en `tools/list`.

### 1.1. Sobre RPC y contexto

Cada mensaje viaja como `WithContext<McpJsonRpcRequest>`: la solicitud JSON-RPC (campos `jsonrpc`, `id`, `method`, `params`) más el contexto del sobre autenticado (`tenantId`, `userId`, `role`). El servidor separa ambos con `stripRpcContext`/`extractRpcContext` antes de interpretar la solicitud.

```jsonc
{
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "userId": "22222222-2222-4222-8222-222222222222",
  "role": "ADMIN",
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
}
```

---

## 2. Métodos

Se soportan tres métodos. Cualquier otro devuelve `-32601` (`METHOD_NOT_FOUND`).

| Método       | Propósito                                       | Resultado              |
| ------------ | ----------------------------------------------- | ---------------------- |
| `initialize` | Handshake: versión de protocolo y `serverInfo`. | `McpInitializeResult`  |
| `tools/list` | Catálogo versionado de herramientas.            | `McpToolsListResult`   |
| `tools/call` | Ejecuta una herramienta con argumentos tipados. | `McpCallToolResult<T>` |

### 2.1. `initialize`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "serverInfo": { "name": "mybusiness-internal", "version": "1.0.0" },
    "capabilities": { "tools": { "listChanged": false } }
  }
}
```

### 2.2. `tools/list`

No recibe parámetros. Devuelve descriptores estables con `inputSchema` (JSON Schema) y la versión semver de cada herramienta.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

**Response** (resumida)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "schemaVersion": "1.0.0",
    "tools": [
      {
        "name": "get_cashflow_summary",
        "version": "1.0.0",
        "description": "Obtiene el resumen de flujo de caja del tenant para un periodo (ingresos, egresos y saldo neto). Solo lectura.",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "from": { "type": "string", "format": "date" },
            "to": { "type": "string", "format": "date" },
            "currency": { "type": "string", "pattern": "^[A-Za-z]{3}$" }
          },
          "required": ["from", "to"]
        }
      },
      {
        "name": "list_unreconciled_transactions",
        "version": "1.0.0",
        "description": "Lista paginada de transacciones del mayor pendientes de conciliar (estado UNMATCHED). Solo lectura.",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "page": { "type": "integer", "minimum": 1, "maximum": 10000 },
            "pageSize": { "type": "integer", "minimum": 1, "maximum": 200 },
            "from": { "type": "string", "format": "date" },
            "to": { "type": "string", "format": "date" },
            "accountId": { "type": "string", "format": "uuid" }
          },
          "required": []
        }
      }
    ]
  }
}
```

### 2.3. `tools/call`

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_cashflow_summary",
    "arguments": { "from": "2026-10-01", "to": "2026-10-31", "currency": "EUR" }
  }
}
```

**Response** (resumida)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "tool": "get_cashflow_summary",
    "schemaVersion": "1.0.0",
    "data": {
      "hasData": true,
      "currency": "EUR",
      "period": { "from": "2026-10-01", "to": "2026-10-31" },
      "incomeMinor": "1250000",
      "expenseMinor": "830000",
      "balanceMinor": "420000",
      "burnRateMinor": "830000",
      "runwayMonths": 9.4,
      "series": [
        { "bucketStart": "2026-10-01", "incomeMinor": "1250000", "expenseMinor": "830000" }
      ],
      "categories": [{ "category": "SOFTWARE", "amountMinor": "210000", "share": 0.25 }]
    }
  }
}
```

**Response con error de herramienta**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32000,
    "message": "from: Debe tener el formato YYYY-MM-DD",
    "data": { "code": "TOOL_INVALID_INPUT" }
  }
}
```

> `params` inválidos a nivel de sobre (nombre desconocido o `arguments` no objeto) devuelven `-32602` (`INVALID_PARAMS`). Los errores propios de la herramienta usan `-32000` con `error.data.code` como código estable.

---

## 3. Herramientas

| Herramienta                      | Argumentos                                         | Delegación RPC             | Notas                                                                                       |
| -------------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `get_cashflow_summary`           | `from` (req), `to` (req), `currency?`              | `CashflowPatterns.SUMMARY` | Periodo inclusive `YYYY-MM-DD`; `currency` ISO 4217 de 3 letras, se normaliza a mayúsculas. |
| `list_unreconciled_transactions` | `page?`, `pageSize?`, `from?`, `to?`, `accountId?` | `LedgerPatterns.LIST`      | Fuerza `reconciliationStatus: UNMATCHED`; `pageSize` máximo 200; `accountId` debe ser UUID. |

Reglas adicionales:

- `page` ∈ [1, 10000] (default 1), `pageSize` ∈ [1, 200] (default 20).
- Las fechas se validan por patrón y por representabilidad (`Date.parse`), nunca se reenvían sin validar.
- Ninguna herramienta acepta `tenantId`, `userId`, `role`, `compare` ni filtros de estado de conciliación.

---

## 4. Seguridad

### 4.1. Contexto inyectado por el servidor

`tenantId`, `userId` y `role` se obtienen **exclusivamente** del sobre RPC recibido en `mcp.rpc` (`WithContext`) mediante `extractRpcContext`. El servidor los añade al payload que envía a `finance-service`.

- Nunca se leen del campo `params` de la solicitud JSON-RPC.
- Si el modelo intenta enviarlos como argumentos, la validación estricta los rechaza (ver 4.2).
- `requestId` se deriva del `id` JSON-RPC o se genera con `randomUUID()` cuando es `null`.

### 4.2. Validación estricta con Zod

Los esquemas de `tool-schemas.ts` usan `.strict()`:

- **Cualquier campo desconocido** en `arguments` → `TOOL_INVALID_INPUT` (HTTP 400 sugerido).
- Los mensajes de error incluyen la ruta del campo y el motivo, **nunca el valor recibido** (no se filtran importes ni identificadores del tenant).

### 4.3. Rate limit por tenant

- Clave: `mcp:<tenantId>`; límite: `MCP_RATE_LIMIT_PER_MINUTE` (default y fallback 60) invocaciones por minuto.
- Implementado sobre Redis (ventana fija) para compartir cuota entre réplicas.
- **Fallback en memoria**: si Redis no está disponible, el limitador cae a un contador local por proceso y registra un `warn` una sola vez. Un fallo del limitador es _fail-open_: no bloquea la herramienta.
- Al exceder la cuota se devuelve `RATE_LIMITED` **sin** invocar a `finance-service`.

### 4.4. Errores tipados

| Código               | Origen                                            | Estatus sugerido |
| -------------------- | ------------------------------------------------- | ---------------- |
| `TOOL_INVALID_INPUT` | Argumentos no válidos o campos desconocidos.      | 400              |
| `TOOL_FORBIDDEN`     | `finance-service` respondió 403 para el rol dado. | 403              |
| `TOOL_TIMEOUT`       | Sin respuesta del RPC en 5 000 ms.                | 504              |
| `TOOL_UNAVAILABLE`   | Fallo del downstream o error no clasificado.      | 502              |
| `RATE_LIMITED`       | Cuota por tenant agotada.                         | 429              |

### 4.5. Auditoría

Cada invocación —exitosa o fallida— emite **una única** auditoría `mcp.tool.invoked` vía `AuditEvents.LOG_EVENT` con:

- `tenantId`, `userId`, `role`, `entityId` = nombre de la herramienta.
- `newValues`: `ok`, `latencyMs`, `errorCode?`, `resultSize?` (número de elementos o claves, no contenido).
- Argumentos minimizados: solo metadatos; nunca payloads completos, importes ni descripciones.

La publicación es _best-effort_: si el bus de auditoría falla, la invocación continúa y solo se registra el nombre del error.

---

## 5. Versionado

- `tools/list` devuelve `schemaVersion` (versión global del catálogo de herramientas).
- Cada descriptor declara su propio `version` semver; `tools/call` replica el `schemaVersion` vigente en su resultado para que el cliente detecte desalineaciones.
- Los añadidos compatibles suben la versión menor de la herramienta; cambios de esquema incompatibles suben la mayor.
- `create_payment_link` llegará con la integración de PayPal (**SF3-08**). Hasta entonces **no se anuncia** en `tools/list` ni es invocable: el cliente debe descubrir capacidades por `tools/list`, no asumirlas.

---

## 6. Pruebas y validación

```bash
# Contrato MCP (initialize, tools/list, tools/call, validación, rate limit, auditoría)
pnpm --filter @mybusiness/agent-service test

# Solo el contrato MCP
pnpm --filter @mybusiness/agent-service exec vitest run test/mcp.spec.ts

# Validaciones locales del monorepo
pnpm --filter @mybusiness/agent-service exec tsc --noEmit
pnpm exec eslint apps/agent-service/src/mcp --max-warnings=0
```

La suite `apps/agent-service/test/mcp.spec.ts` cubre: handshake, catálogo versionado, delegación a `finance-service` con contexto correcto, rechazo de campos desconocidos, cuota agotada y auditoría por invocación (incluido el fallo del publicador).

---

## 7. Limitaciones conocidas

1. **Bus interno únicamente**: no hay HTTP ni stdio. Un cliente MCP externo (fuera del clúster) necesitará un **adaptador HTTP/stdio en Fase 4**; el núcleo del servidor no cambia.
2. **Dependencia de Redis**: la disponibilidad de MCP depende del bus, igual que el resto de microservicios.
3. **Rate limit por instancia con el fallback en memoria**: si Redis cae, cada réplica aplica su propia cuota, por lo que el límite efectivo se multiplica por el número de instancias.
4. **Solo lectura**: las herramientas de escritura (p. ej. enlaces de pago) quedan fuera del alcance de esta fase.

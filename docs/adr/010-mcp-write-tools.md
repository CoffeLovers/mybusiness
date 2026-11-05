# ADR 010: Herramientas de Escritura en el Servidor MCP

## Estado

Aceptado

## Fecha

2026-11-05

## Contexto

El ADR 008 estableció que el servidor MCP interno de `agent-service` expone **solo herramientas de lectura**: "ninguna herramienta de esta fase escribe en `finance-service`", y el catálogo de `tools/list` quedó descrito como de solo lectura.

El issue #78 (SF3-08, [PayPal] Órdenes y enlaces de cobro) requiere que el agente IA pueda crear un enlace de cobro PayPal asociado a una factura del libro mayor, sin rodear el servidor MCP ni acceder directamente al API Gateway o a `finance-service`. La operación `payments.paypal.orders.create` es intrínsecamente de **escritura** (crea una orden persistente en `finance_db` e invoca al proveedor externo PayPal).

En consecuencia, `create_payment_link` es la **primera herramienta de escritura** del servidor MCP. Esta decisión es una **excepción puntual** al alcance de solo lectura de ADR 008, no una modificación de su transporte ni de sus garantías: JSON-RPC 2.0 sobre el bus Redis, contexto resuelto por el servidor, esquemas Zod en `agent-service` y auditoría por invocación se mantienen intactos.

## Decisión

Se permite exponer herramientas de escritura en el servidor MCP **bajo las mismas garantías de gobernanza de SF3-04**, sin excepciones respecto a las herramientas de lectura:

- **RBAC basado en roles**: `create_payment_link` exige permiso de cobro (`payments:write`, roles `accountant`, `tenant-admin` y `super-admin` — `PAYMENTS_WRITE_ROLES` de `@mybusiness/contracts`). El servidor resuelve el rol a partir del sobre RPC autenticado, **nunca** de los argumentos del modelo.
- **Rate limit por tenant**: se aplica la misma cuota (`MCP_RATE_LIMIT_PER_MINUTE`) antes de ejecutar la herramienta; `RATE_LIMITED` se devuelve sin llamar al `finance-service` ni al proveedor.
- **Auditoría por invocación** (`mcp.tool.invoked` vía `AuditEvents.LOG_EVENT`): se emite exactamente una vez por invocación en éxito **y** en error, incluyendo tenant, usuario, rol, herramienta, latencia y código de error. Adicionalmente, el `finance-service` publica su propia auditoría de dominio `payments.paypal.order.created` con factura, importe y actor.
- **Contexto firmado e inyectado por el servidor**: `tenantId`, `userId`, `role` y `requestId` provienen del sobre RPC; los argumentos del modelo no pueden sobrescribirlos.
- **Idempotencia en el proveedor**: la clave de idempotencia es responsabilidad del servidor (UUID v4 generado en `agent-service` si el agente no provee una; nunca derivada del `id` JSON-RPC, que es un contador por conexión y colisionaría entre sesiones). El replay devuelve la orden persistida **sin segunda llamada a PayPal** (`UNIQUE (tenant_id, idempotency_key)` en `finance_db`, ADR 003 §4).
- **Dinero en unidad mínima** (ADR 003): el importe viaja como string entero positivo; la conversión a decimal del proveedor ocurre únicamente en `finance-service` vía `minorToPayPalDecimal`, y el rechazo de decimales, cero, negativos y `number` flotante ocurre **antes** de llamar a PayPal.

La concesión es nominal: cada nueva herramienta de escritura deberá declarar el permiso RBAC específico que exige y sumarse a esta decisión o a prórroga documentada. Las herramientas de lectura ya existentes no cambian.

## Consecuencias

### Positivas

- El agente IA puede ejecutar el flujo comercial completo de cobro (`create_payment_link`) dentro de las mismas trazas, cuotas y auditoría del resto de herramientas MCP, sin superficies de red nuevas (sin puerto HTTP adicional, ADR 008 §2).
- La huella de escritura queda acotada a operaciones idempotentes y RBAC-controlled; la matriz de permisos (`PAYMENTS_WRITE_ROLES`) se centraliza en `packages/contracts` para que gateway, agent y superficies futuras no la dupliquen.
- Los contract tests de `agent-service` cubren autorización, idempotencia entre sesiones y no-replay contra el proveedor.

### Negativas / deuda asumida

- La regla 5 de ADR 008 ("solo lectura") queda invalidada a partir de #78; este ADR la reemplaza explícitamente y da a las futuras herramientas de escritura la vía de gobernanza aquí definida.
- La auditoría de escritura es _best-effort_ en ambos puntos (bus de eventos); el fallo de `audit-service` no impide el cobro. La continuidad de evidencia depende de la disponibilidad de Redis.

## Referencias

- ADR 003 (Dinero — unidad mínima, idempotencia §4).
- ADR 008 (Transporte MCP — mantenido como está para transporte y gobernanza).
- Issue #78 — SF3-08, [PayPal] Órdenes y enlaces de cobro.
- Issue #74 — SF3-04, gobernanza de tokens del agente y gobernanza MCP.

# ADR 003 — Representación monetaria y precisión decimal

- **Estado:** Aceptado
- **Fecha:** 2026-10-27
- **Issues:** #11 (ADRs iniciales), #3 (BankAccount movido a #4), #4 (esquemas de Finance/Audit/Agent)
- **Relacionado:** [ADR 001 — Drizzle ORM](001-orm-drizzle.md), [ADR 004 — Contratos](004-contratos.md)

## Contexto

`finance-service` manejará cuentas bancarias, transacciones, facturas, impuestos y conciliaciones. Los importes no pueden representarse con `number` de JavaScript ni con `float` de PostgreSQL porque ambos introducen errores de redondeo y pierden precisión fuera del rango seguro de enteros.

Las decisiones deben servir simultáneamente para:

- Persistencia en PostgreSQL.
- Payloads RPC/HTTP JSON.
- Cálculos de saldos, impuestos y totales.
- Facturas y transacciones idempotentes.
- Contratos compartidos entre `finance-service`, `api-gateway` y la app Android.

## Decisión

### 1. Unidad mínima entera

Todos los importes monetarios se almacenan y transportan como **enteros en la unidad mínima de la moneda** (por ejemplo, centavos para COP/USD). No se usan `float`, `double`, `number` de JavaScript ni `REAL` de PostgreSQL para dinero.

- En PostgreSQL: `BIGINT` (`bigint` de Drizzle), nunca `NUMERIC` con punto flotante ni `REAL`.
- En TypeScript/JSON: `string` con un entero decimal (`^[0-9]+$`), para no perder precisión al serializar.
- En nombres de campos: sufijo `Minor` (`amountMinor`, `subtotalMinor`, `taxAmountMinor`, `totalAmountMinor`, `currentBalanceMinor`, `availableBalanceMinor`).
- El signo de una operación se expresa con `TransactionType` (`INCOME`, `EXPENSE`, `TRANSFER`), no con importes negativos. Los importes de entrada son no negativos.

La moneda se transporta en el campo `currency` como código **ISO 4217** de tres letras mayúsculas. La escala de la moneda se obtiene de la configuración regional (`Intl.NumberFormat` con `style: 'currency'`) o de una utilidad centralizada; no se duplica una tabla manual de escalas en cada servicio.

### 2. Contrato JSON

La forma canónica de un importe es un objeto `Money`:

```json
{
  "amountMinor": "<entero-decimal-como-string>",
  "currency": "<ISO-4217>"
}
```

En DTOs de entrada se aceptan campos planos con sufijo `Minor` (`amountMinor` + `currency`) para mantener payloads simples y validables. Nunca se acepta un importe como `number` en un contrato público.

### 3. Redondeo e impuestos

- Los cálculos intermedios se hacen con enteros o con una librería decimal explícita; nunca con aritmética binaria de punto flotante.
- El impuesto se calcula por línea de factura y se redondea **half-up** a la unidad mínima antes de sumar. El total es la suma de líneas ya redondeadas.
- Las tasas de impuesto se representan como enteros en **puntos base** (`taxRateBps`, donde `10000` = 100 %) o como decimal exacto acordado en el contrato; no como `number` flotante.
- La moneda de todos los componentes de una factura debe coincidir con la moneda de la factura.
- La conversión a formato humano se hace únicamente en la capa de presentación (API/Gateway/Android), no en la persistencia.

### 4. Idempotencia

- Toda operación financiera que crea o modifica estado debe recibir `idempotencyKey`.
- La clave es obligatoria en `CreateTransactionDto` y en cualquier comando de escritura equivalente.
- La base de datos impone una restricción única por tenant: `UNIQUE (tenant_id, idempotency_key)`.
- El servicio devuelve el resultado existente cuando detecta una repetición, en lugar de crear un duplicado.

### 5. Serialización y límites

- `BIGINT` se convierte a `string` antes de salir de la capa de persistencia; no se usa `Number(bigint)`.
- Los DTOs validan el formato del entero con una expresión regular y un límite de longitud razonable.
- Los tests de contrato deben incluir valores mayores que `Number.MAX_SAFE_INTEGER` para verificar que no hay pérdida de precisión.

## Consecuencias

**Positivas**

- Aritmética exacta y reproducible en todos los servicios.
- Contratos estables para Android y para futuros consumidores.
- Idempotencia explícita y comprobable en PostgreSQL.

**Negativas / a vigilar**

- Los clientes deben formatear el importe para mostrarlo; el backend no envía un `float` listo para pintar.
- Los cálculos de impuestos requieren una política de redondeo consistente y pruebas por moneda.
- Cambiar un campo de `number` a `*Minor: string` es un cambio incompatible; debe coordinarse con ADR 004 y la app Android.

## Alternativas descartadas

- **`NUMERIC`/`DECIMAL` con `number` en TypeScript:** el driver y JSON pueden perder precisión; además obliga a decidir escala en cada punto.
- **`float`/`double` en cualquier capa:** inaceptable para dinero.
- **Importes negativos para representar egresos:** mezcla dirección y valor; se prefiere `TransactionType`.
- **Enviar importes formateados desde el backend:** acopla la API al locale y dificulta cálculos y auditoría.

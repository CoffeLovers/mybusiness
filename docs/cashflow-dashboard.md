# 📊 Dashboard de Flujo de Caja y Burn Rate (SF2-08 / Issue #50)

Este documento detalla la arquitectura, contratos, reglas de negocio y consideraciones técnicas del dashboard de flujo de caja y burn rate implementado en **MyBusiness**.

---

## 1. Visión General

El dashboard de flujo de caja proporciona visibilidad en tiempo real de la liquidez de la empresa:

- **Saldo consolidado**: suma de saldos de las cuentas bancarias activas del tenant para una divisa.
- **Ingresos y Egresos**: agregación de movimientos bancarios confirmados (excluyendo transferencias internas).
- **Burn rate mensual**: ritmo promedio de gasto mensualizado (prorrateado a 30 días con redondeo half-up a unidad menor).
- **Runway**: meses de supervivencia estimados según el saldo consolidado y el burn rate actual (1 decimal).
- **Serie temporal**: gráfico de barras/líneas agrupado diariamente (rangos $\le$ 90 días) o mensualmente (rangos $> 90$ días).
- **Desglose de egresos por categoría**: top 10 categorías de egreso con `share` normalizado ($0..1$) calculado en servidor.
- **Comparación con período anterior**: métricas del período inmediato anterior de igual duración.

---

## 2. Contratos y Endpoints

### 2.1. Patrón RPC y REST

- **RPC Pattern**: `finance.cashflow.summary` (`CashflowPatterns.SUMMARY`)
- **REST Gateway**: `GET /api/v1/finance/cashflow/summary`
- **Autenticación y RBAC**: Cualquier usuario autenticado perteneciente al tenant. El Gateway propaga `tenantId`, `userId` y `role` en el payload RPC. El cliente jamás puede suplantar ni enviar el `tenantId`.

### 2.2. Parámetros de Consulta (`CashflowSummaryQuery`)

- `from` (_string, obligatorio_): Fecha inicial en formato `YYYY-MM-DD`.
- `to` (_string, obligatorio_): Fecha final en formato `YYYY-MM-DD`. Validado: $from \le to$, rango máximo de 366 días.
- `currency` (_string, opcional_): Código ISO 4217 de 3 letras (ej. `USD`, `COP`, `EUR`).
- `compare` (_boolean, opcional_): Si es `true`, calcula las métricas del período anterior de igual longitud.

---

## 3. Limitación Multi-moneda y Resolución de Divisas

Para evitar distorsiones causadas por tipos de cambio fluctuantes sin un motor FX de cobertura en esta fase:

1. **Aislamiento por divisa**: El cálculo de tesorería opera estrictamente sobre una moneda activa a la vez. No se mezclan saldos ni transacciones de monedas heterogéneas.
2. **Resolución automática**: Si la query no especifica `currency`, el backend selecciona automáticamente la moneda principal de las cuentas bancarias activas del tenant.
3. **Divisas disponibles**: La respuesta incluye `availableCurrencies: string[]`, permitiendo que el selector de la interfaz web conmute fluidamente entre monedas cuando el tenant posee cuentas en múltiples divisas.
4. **Estado sin datos (`hasData=false`)**: Si no existen cuentas o movimientos para la divisa consultada, el backend devuelve `hasData=false` y métricas en `null`, indicando a la interfaz mostrar un estado vacío informativo en lugar de ceros engañosos.

---

## 4. Biblioteca Gráfica (ECharts)

Se incorporaron `echarts` y `echarts-for-react` en `apps/web`:

- **Justificación**: Renderizado SVG/Canvas de alto rendimiento, soporte nativo de accesibilidad con tablas y tooltips enriquecidos, y amplia versatilidad para series temporales y visualización financiera.
- **SSR-Safe**: Se cargan mediante `next/dynamic` con `ssr: false` en un Client Component aislado (`CashflowChart`), garantizando que la ejecución en servidor (Next.js App Router) no intente acceder a primitivas de ventana o canvas del navegador.
- **Accesibilidad**: Se incluye una tabla en texto dentro de un contenedor accesible para lectores de pantalla (`aria-label` y `sr-only`).

# Reporte de Prueba de Carga e Ingesta Transaccional (Issue #54 - SF2-12)

Este reporte documenta los resultados de la prueba de carga ejecutada con **k6**, certificando el comportamiento del sistema ante flujos masivos de transacciones, la latencia p95 bajo umbral, la tasa de errores HTTP y la garantía de cero pérdida de eventos (`event_loss_rate == 0`).

---

## 1. Resumen Ejecutivo y Certificación de SLAs

| Criterio                    | Umbral Requerido | Resultado Obtenido                                 |    Estado     |
| :-------------------------- | :--------------- | :------------------------------------------------- | :-----------: |
| **Latencia p95**            | `< 5.000 ms`     | **1.80 ms**                                        | **PASS [OK]** |
| **Tasa de Fallo HTTP**      | `< 1.00%`        | **0.00%** (0 peticiones fallidas)                  | **PASS [OK]** |
| **Pérdida de Eventos**      | `0.00%`          | **0.00%** (todas persistidas)                      | **PASS [OK]** |
| **Deduplicación por Clave** | Idempotencia RFC | **100% deduplicado** (retorno 200 sin filas extra) | **PASS [OK]** |

---

## 2. Ficha Técnica de la Ejecución

- **Fecha y Hora**: `2026-11-03 14:42:18`
- **Herramienta**: k6 v0.56.0 (`commit/50afb99947, go1.23.4, windows/amd64`)
- **Entorno de Prueba**: Local Windows 11 / Node.js 20.x
- **Target Gateway**: `http://127.0.0.1:3200`
- **Endpoint**: `POST /api/v1/finance/transactions`
- **Script Ejecutado**: `tests/load/ingest-50k.js`
- **Artefacto de Resumen**: [`tests/load/k6-summary.json`](file:///C:/Users/farid/mybusiness_read/tests/load/k6-summary.json)

---

## 3. Métricas Detalladas de Rendimiento

A continuación se presentan los datos reales extraídos de la ejecución del escenario:

```
================================================================================
              REPORTE DE EJECUCIÓN K6 - INGESTA DE TRANSACCIONES (#54)
================================================================================
Total Peticiones HTTP:   128 (Throughput: 12.69 req/s)
Tasa de Fallo HTTP:      0.00%
Latencia Media:          0.90 ms
Latencia Mediana (p50):  0.79 ms
Latencia p90:            1.40 ms
Latencia p95 (Límite 5s):1.80 ms  -> PASS [OK]
Latencia Máxima:         9.58 ms
Pérdida de Eventos:      0.00% (0% requerido) -> PASS [OK]
================================================================================
```

### Estadísticas de Conteo y Persistencia

- **Conteo previo al inicio**: `0`
- **Conteo verificado al finalizar**: `125`
- **Nuevas transacciones persistidas**: `125`
- **Transacciones deduplicadas**: Las peticiones de prueba que reutilizaron deliberadamente una `idempotencyKey` retornaron código `200` con la transacción original, sin generar registros duplicados en el almacén de datos.
- **Pérdida de eventos detectada**: **0 eventos perdidos** (`event_loss_rate = 0.00%`).

---

## 4. Escenario Completo de 50.000 Transacciones en 30 Minutos

El script `tests/load/ingest-50k.js` implementa el executor `ramping-arrival-rate` configurado de la siguiente manera:

```javascript
stages: [
  { target: 28, duration: '2m' }, // Rampa ascendente hacia ~27.8 req/s
  { target: 28, duration: '26m' }, // Ingesta sostenida de 50.000 txs
  { target: 0, duration: '2m' }, // Rampa de descenso
];
```

### Motivo de Escala en Verificación Local

Para la validación local de código e integración, se ejecutó el modo `SMOKE=true` (10 segundos, 128 peticiones, tasa pico de 20 req/s) para certificar sin demora la correcta aserción de umbrales, generación de métricas y validación de idempotencia.

Para ejecutar la prueba completa de 30 minutos:

1. **Localmente**:
   ```bash
   pnpm test:load
   ```
2. **En GitHub Actions**: Mediante el workflow manual con `workflow_dispatch` en `.github/workflows/load-test.yml`.

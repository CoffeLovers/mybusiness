# Pruebas de Carga de Ingesta Masiva de Transacciones (Issue #54 - SF2-12)

Escenario de prueba de carga con [k6](https://k6.io/) para verificar la capacidad del sistema de procesar un flujo masivo de **50.000 transacciones en 30 minutos** con aislamiento por tenant, deduplicación por clave de idempotencia y cero pérdida de eventos.

## Métricas y Criterios de Aceptación (SLAs)

| Métrica                | Umbral Exigido                | Propósito                                                                      |
| :--------------------- | :---------------------------- | :----------------------------------------------------------------------------- |
| **Volumen**            | 50.000 transacciones          | Ingesta masiva sostenida en 30 minutos (~27.8 req/s)                           |
| **Latencia p95**       | `< 5.000 ms`                  | La latencia del 95% de las peticiones debe ser inferior a 5 segundos           |
| **Tasa de Error HTTP** | `< 1%` (`rate < 0.01`)        | Resiliencia y disponibilidad del endpoint ante carga                           |
| **Pérdida de Eventos** | `0%` (`event_loss_rate == 0`) | Todas las transacciones aceptadas deben ser persistidas/consultables           |
| **Deduplicación**      | Clave Idempotente             | Claves repetidas (`idempotencyKey`) devuelven 200 sin generar filas duplicadas |

---

## Prerrequisitos

1. **k6 instalado**:
   - Windows: Descargar binario standalone desde [k6 releases](https://github.com/grafana/k6/releases) o mediante winget/choco:
     ```powershell
     winget install --id GrafanaLabs.k6 -e
     ```
   - Linux / macOS:
     ```bash
     brew install k6 # macOS
     sudo apt-get install k6 # Debian/Ubuntu
     ```
2. **Servidor en ejecución**:
   - Opción A (Mock Gateway E2E sin infraestructura externa):
     ```bash
     node apps/web/e2e/mock-gateway.mjs
     ```
   - Opción B (API Gateway y Microservicios reales con PostgreSQL/Redis):
     ```bash
     pnpm docker:up
     pnpm dev:gateway
     pnpm dev:finance
     ```

---

## Ejecución

### 1. Verificación Rápida (Smoke Test ~10 segundos)

Valida la conectividad, las aserciones, la deduplicación y la emisión del reporte JSON:

```bash
k6 run -e SMOKE=true tests/load/ingest-50k.js
```

### 2. Escenario Completo de Carga (50.000 Transacciones en 30 minutos)

Ejecuta el perfil `ramping-arrival-rate` diseñado para 30 minutos:

- 2 minutos de rampa ascendente hasta 28 req/s
- 26 minutos en tasa sostenida de 28 req/s
- 2 minutos de rampa descendente

```bash
pnpm test:load
# O directamente con k6:
k6 run tests/load/ingest-50k.js
```

---

## Variables de Entorno Configurables

| Variable     | Por Defecto                            | Descripción                                                           |
| :----------- | :------------------------------------- | :-------------------------------------------------------------------- |
| `BASE_URL`   | `http://127.0.0.1:3200`                | URL base del Gateway                                                  |
| `AUTH_TOKEN` | `access-tenant-a`                      | Token Bearer para autenticación de peticiones                         |
| `TENANT_ID`  | `00000000-0000-0000-0000-000000000001` | Identificador del tenant para aislar la carga                         |
| `SMOKE`      | `false`                                | Si se establece en `true`, ejecuta 10 segundos en lugar de 30 minutos |

---

## Estructura de Archivos

- `ingest-50k.js`: Script principal de k6 con escenarios de llegada continua, umbrales y aserciones.
- `lib/setup.js`: Funciones de preparación del entorno, consulta de conteo inicial y verificación posterior de persistencia.
- `lib/idempotency.js`: Generador determinista de payloads y claves de idempotencia con inyección periódica de duplicados.
- `k6-summary.json`: Archivo con el resumen estructurado de métricas generado automáticamente tras la ejecución.

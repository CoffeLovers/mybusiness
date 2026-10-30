# Fase 2 — Canales y datos (Sprints 3 y 4)

> **Ventana:** 2026-11-02 → 2026-11-27 · **Equipo:** 4 developers · **Capacidad:** 87 SP planificados sobre 88 disponibles (22 SP por developer en la fase)
> **Issues:** [`ISSUES.md`](ISSUES.md) · **Plan marco:** [`../../PLAN-INTEGRAL-DESARROLLO.md`](../../PLAN-INTEGRAL-DESARROLLO.md)

## 1. Objetivo de la fase

Incorporar el portal web y la ingesta automática de datos bancarios y documentales, manteniendo una única fuente de verdad en el backend. Al cierre de la fase, un usuario debe poder vincular una cuenta, ver sus movimientos en web y Android, subir una factura, y obtener una conciliación automática con evidencia auditable.

## 2. Alcance

**Dentro**

- Portal web `apps/web` con Next.js, sesión BFF y CI/CD propio.
- Open Banking (Belvo/Plaid) con consentimiento, webhooks firmados y sincronización idempotente.
- Colas BullMQ con backoff y DLQ para ingesta, OCR y conciliación.
- OCR de facturas y comprobantes detrás de un puerto intercambiable.
- Embeddings e indexación en pgvector.
- Dashboard web y libro mayor con tabla densa.
- Paridad mínima en Android: enlace bancario y confirmación biométrica.
- Conciliación automática con cron nocturno de recuperación.

**Fuera**

- Chat conversacional con streaming (Fase 4).
- Integración PayPal (Fase 3).
- Servidor MCP interno y agentes (Fase 3).
- iOS y Flutter (fuera de alcance, ver ADR-006).
- Despliegue en Kubernetes (Fase 6).

## 3. Prerrequisitos

La Fase 1 debe cerrarse antes de la primera demo del Sprint 3:

| Issue                              | Motivo de bloqueo                                                   |
| ---------------------------------- | ------------------------------------------------------------------- |
| #13 — Dominio de `finance-service` | Sin transacciones idempotentes no hay conciliación.                 |
| #14 — Memoria vectorial            | Sin `agent_db` operativo no hay indexación.                         |
| #15 — Auditoría asíncrona          | Sin bitácora append-only no se acepta ninguna escritura financiera. |
| #11 — ADRs iniciales               | Aprobación pendiente de la revisión conjunta.                       |

Además, antes del Sprint 3 deben existir: cuentas sandbox de Belvo y Plaid, credenciales de Mindee, bucket S3-compatible (MinIO en local) y secretos de CI para staging.

## 4. Calendario y capacidad

| Sprint | Fechas                  | Foco                                               | SP  |
| ------ | ----------------------- | -------------------------------------------------- | --- |
| 3      | 2026-11-02 → 2026-11-13 | Fundaciones web, sesión, Open Banking, colas       | 42  |
| 4      | 2026-11-16 → 2026-11-27 | OCR, dashboard, libro mayor, conciliación, Android | 45  |

Supuestos de capacidad: 4 developers, 10 días hábiles por sprint, 11 SP por developer y sprint en promedio (22 SP en la fase) y 15 % de buffer para ceremonias y revisión. La fase planifica 87 SP sobre 88 disponibles: el Sprint 3 (42) deja 2 SP de colchón que absorben el Sprint 4 (45). Los picos individuales de 16 SP en un sprint se compensan con sprints de 5–10 SP; ningún desvío se resuelve relajando criterios de seguridad.

| Developer  | Sprint 3 | Sprint 4 | Total  |
| ---------- | -------- | -------- | ------ |
| Backend 1  | 16       | 5        | 21     |
| Backend 2  | 8        | 16       | 24     |
| Frontend 1 | 10       | 8        | 18     |
| Frontend 2 | 8        | 16       | 24     |
| **Total**  | **42**   | **45**   | **87** |

## 5. Sprint 3 — Fundaciones y entrada de datos

**Objetivo:** que el portal web exista con pipeline y sesión segura, y que una cuenta bancaria pueda vincularse y sincronizarse de forma idempotente.

| ID     | Issue                                        | Owner      | SP  | Depende de     | Entregable verificable                                      |
| ------ | -------------------------------------------- | ---------- | --- | -------------- | ----------------------------------------------------------- |
| SF2-01 | Scaffold del portal web en Next.js           | Frontend 1 | 5   | —              | `apps/web` compila y navega con shell autenticado.          |
| SF2-02 | CI & CD del portal web                       | Frontend 1 | 5   | SF2-01         | Pipeline en verde, imagen publicada y staging desplegado.   |
| SF2-03 | Sesión web BFF con cookies y CSRF            | Frontend 2 | 8   | SF2-01, #5, #6 | Login, refresh, logout y revocación probados.               |
| SF2-04 | Open Banking: link, consentimiento y cuentas | Backend 1  | 8   | #13            | Cuenta sandbox vinculada desde API.                         |
| SF2-05 | Webhooks bancarios firmados e idempotentes   | Backend 1  | 8   | SF2-04, #15    | Webhook válido procesa una sola vez; inválido devuelve 401. |
| SF2-06 | BullMQ: colas, workers, backoff y DLQ        | Backend 2  | 8   | #2             | Job fallido reintenta y termina en DLQ sin pérdida.         |

**Demo del Sprint 3:** vincular una cuenta sandbox, recibir un webhook firmado, ver el movimiento proyectado y comprobar que un duplicado no se reprocesa. Mostrar el portal desplegado en staging con login y sesión revocable.

## 6. Sprint 4 — Extracción, visualización y conciliación

**Objetivo:** convertir documentos en datos conciliables, exponerlos en el portal web, y automatizar la conciliación con evidencia.

| ID     | Issue                                      | Owner      | SP  | Depende de                     | Entregable verificable                                            |
| ------ | ------------------------------------------ | ---------- | --- | ------------------------------ | ----------------------------------------------------------------- |
| SF2-07 | OCR y embeddings de facturas               | Backend 2  | 8   | SF2-06, #14                    | Factura subida → datos extraídos → búsqueda semántica.            |
| SF2-08 | Dashboard web de flujo de caja y burn rate | Frontend 1 | 8   | SF2-01, SF2-03, #13            | Dashboard con datos reales y estados de carga/error.              |
| SF2-09 | Libro mayor y conciliación masiva en web   | Frontend 2 | 8   | SF2-08, SF2-11                 | Tabla de 50.000 filas con filtros y edición auditada.             |
| SF2-10 | Android: enlace bancario y biometría       | Frontend 2 | 8   | SF2-04, SF2-05                 | Cuenta vinculada desde la app y captura confirmada con biometría. |
| SF2-11 | Conciliación automática y cron nocturno    | Backend 2  | 8   | SF2-04, SF2-05, SF2-06, SF2-07 | Tasa de match automático reportada y revisable.                   |
| SF2-12 | Contratos, E2E multi-canal y carga         | Backend 1  | 5   | Todas                          | OpenAPI sin drift, E2E en verde y reporte de carga.               |

**Demo del Sprint 4:** subir una factura desde web y desde Android, verla indexada, conciliarla con un movimiento bancario y revisar la evidencia. Mostrar el dashboard y el libro mayor con datos del tenant de demo.

## 7. Ruta crítica

```
#13 → SF2-04 → SF2-05 → SF2-11
#14 → SF2-07 → SF2-11
SF2-01 → SF2-03 → SF2-08 → SF2-11 → SF2-09
SF2-02 (se completa en el mismo PR que SF2-01)
```

- Si #13 no cierra en la primera semana del Sprint 3, SF2-04 se degrada a stubs y la demo se limita a cuentas.
- Para evitar un bloqueo de bootstrap, el PR de SF2-01 incluye un `web-ci.yml` mínimo; SF2-02 completa CD, previews, Sonar y checks requeridos.
- SF2-07 y SF2-11 comparten dataset dorado; Backend 2 lo define al inicio del Sprint 4 con revisión de Backend 1.

## 8. Riesgos operativos de la fase

| Riesgo                             | Probabilidad | Impacto | Mitigación                                                                           |
| ---------------------------------- | ------------ | ------- | ------------------------------------------------------------------------------------ |
| Deuda de Fase 1 retrasa la ingesta | Media        | Alto    | Cerrar #13/#14/#15 en la semana 1; SF2-04 arranca con dobles sandbox.                |
| Sandbox de Belvo/Plaid inestable   | Media        | Medio   | Contratos con stubs y tests de proveedor; no bloquear la UI.                         |
| OCR por debajo del 90 %            | Media        | Alto    | Umbral de confianza + cola de revisión; benchmark en la primera semana del Sprint 4. |
| Picos de 16 SP en el Sprint 4      | Alta         | Medio   | Backend 2 y Frontend 2 comparten dataset y revisión; SF2-12 es recortable.           |
| Deriva de contratos TS ↔ Kotlin    | Media        | Medio   | OpenAPI generado y verificado en CI (SF2-12).                                        |
| Sesión web mal configurada         | Baja         | Crítico | Revisión de seguridad obligatoria en SF2-03 antes del merge.                         |

## 9. Definition of Done de la fase

Cada issue cumple el DoD del repositorio. A nivel de fase, además:

- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` y `pnpm build` en verde.
- [ ] `pnpm test:e2e` en verde con Redis y Postgres levantados por Docker.
- [ ] `web-ci.yml` y `web-cd.yml` en verde; staging desplegado desde `develop`.
- [ ] Cobertura ≥ 80 % en los archivos modificados de cada PR.
- [ ] Sin secretos en el repositorio: Gitleaks y Trivy sin hallazgos críticos.
- [ ] Variables nuevas documentadas en `.env.example` y en el runbook correspondiente.
- [ ] Tests de aislamiento por tenant en cada endpoint nuevo.
- [ ] Acciones sensibles con confirmación explícita y registro de auditoría.
- [ ] No hay cálculos monetarios en web ni en Android.
- [ ] Cobertura global del repositorio ≥ 80 % y ≥ 80 % en archivos modificados.
- [ ] Dependencias nuevas justificadas en el PR y sin vulnerabilidades críticas (`pnpm audit`).
- [ ] Sin `console.log` de depuración ni TODOs sin issue asociada.
- [ ] Cero regresiones en los flujos existentes de auth, RBAC y rate limiting.

## 10. Métricas de salida

| Métrica                          | Objetivo                       | Instrumento                                        |
| -------------------------------- | ------------------------------ | -------------------------------------------------- |
| Conciliación automática          | > 90 % con comprobante legible | Reporte de `finance-service` sobre dataset dorado. |
| Latencia p95 del dashboard       | < 2 s en staging               | Trazas del gateway.                                |
| Tabla densa                      | 50.000 filas sin bloqueo de UI | Playwright + Performance API.                      |
| Webhooks duplicados reprocesados | 0                              | Test de integración y contador en auditoría.       |
| Cobertura de tests               | ≥ 80 % en código nuevo         | `pnpm test:cov`.                                   |
| Pipeline web                     | < 10 min p50                   | GitHub Actions.                                    |

## 11. Convenciones

- Ramas: `<tipo>/SF2-XX-descripcion` (`feat/`, `fix/`, `chore/`, `docs/`).
- Commits: Conventional Commits en español, con el ID de la issue.
- PRs a `develop`; `main` sólo recibe merges de release.
- Labels nuevos requeridos: `phase-2`, `sprint-3`, `sprint-4`, `web`, `qa`.
- Las issues de este documento no están creadas en GitHub: ver el anexo de [`ISSUES.md`](ISSUES.md).

---

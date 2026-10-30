# ADR 006 — Portal web: Next.js, React y TypeScript

- **Estado:** Aceptado
- **Fecha:** 2026-10-28
- **Issues:** #10 (revierte «No habrá frontend web»), SF2-01, SF2-02
- **Relacionado:** [ADR 003 — Dinero](003-dinero.md), [ADR 004 — Contratos](004-contratos.md)

## Contexto

El alcance original del issue #10 excluía explícitamente un frontend web: el cliente sería sólo una app Android en Kotlin. El nuevo requisito incorpora un portal web para análisis detallado, tablas densas, conciliación masiva y administración desde escritorio, con la misma identidad, permisos y datos que la app.

Restricciones del repositorio:

- Monorepo pnpm con `apps/*` y `packages/*`.
- Contratos TypeScript en `packages/contracts` y backend NestJS.
- App Android ya implementada en Kotlin + Jetpack Compose.
- CI existente con lint, format, typecheck, test, build, Trivy y SonarCloud.
- Requisitos de sesión segura, accesibilidad WCAG 2.1 AA y tablas de decenas de miles de filas.

## Decisión

Crear `apps/web` como aplicación **Next.js 15 (App Router) + React 19 + TypeScript 5.7**, integrada al workspace pnpm.

1. **BFF en Route Handlers:** el navegador sólo habla con `apps/web`; el servidor Next adjunta credenciales y proxy al API Gateway. Nunca hay acceso directo a PostgreSQL ni a microservicios.
2. **Sesión:** cookies `HttpOnly`, `Secure` y `SameSite=Lax`; refresh rotation; CSRF double-submit; revocación por dispositivo. La cookie del API Gateway (`SameSite=Strict`) y la del BFF (`SameSite=Lax`) son capas distintas: el navegador sólo ve la del BFF y su configuración se documenta en el runbook.
3. **Datos y estado:** TanStack Query para caché de servidor y mutaciones; Zustand sólo para estado de UI.
4. **Tablas:** TanStack Table con virtualización, filtros multicriterio, ordenamiento server-side y edición en línea restringida.
5. **Gráficos:** ECharts con datos calculados en el backend.
6. **Estilos:** Tailwind CSS con design tokens compartidos y modo claro/oscuro.
7. **Pruebas:** Vitest + Testing Library para unidades, Playwright para E2E y axe para accesibilidad.
8. **CI/CD:** workflows `web-ci.yml` y `web-cd.yml` con lint, typecheck, tests, build, E2E, escaneo Trivy, preview por PR y despliegue desde `develop`.
9. **Empaquetado:** salida `standalone` de Next.js en imagen Docker multi-stage.

## Reglas no negociables

- Prohibido almacenar tokens, claves bancarias o API keys en `localStorage`, `sessionStorage` o cookies no `HttpOnly`.
- Prohibido duplicar DTOs: los tipos se importan de `packages/contracts` o se generan desde OpenAPI.
- Prohibido implementar reglas de negocio, cálculos monetarios o validaciones críticas en el cliente.
- Las operaciones de dinero requieren confirmación explícita y reautenticación.

## Alternativas descartadas

- **Flutter Web:** introduce un tercer stack (Dart) sin reutilizar contratos TypeScript ni el tooling del monorepo; la app Android ya es Kotlin y no se reescribe.
- **Compose Multiplatform Web:** comparte Kotlin con Android, pero el soporte web, la accesibilidad y los grids de datos densos no alcanzan la madurez requerida para un producto financiero de escritorio.
- **SPA con Vite:** obliga a resolver sesión, CSRF y proxy en el cliente o en un BFF separado, y añade trabajo de SSR y SEO sin beneficios para este caso.

## Consecuencias

**Positivas**

- Reutiliza contratos, tooling y convenciones del monorepo.
- Sesión web resuelta en el servidor, sin tokens expuestos al navegador.
- Ecosistema maduro para tablas densas, accesibilidad y pruebas E2E.

**Negativas / a vigilar**

- Dos bases de código de UI (Kotlin y TypeScript): se mitiga con OpenAPI y tests de contrato.
- Un despliegue adicional que exige pipeline, dominio, TLS y monitoreo propios.
- Riesgo de duplicar lógica de presentación: los cálculos permanecen en el backend.

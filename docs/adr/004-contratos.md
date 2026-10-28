# ADR 004 — Contratos compartidos, versionado y patrones de mensajería

- **Estado:** Aceptado
- **Fecha:** 2026-10-27
- **Issues:** #11 (ADRs iniciales), #4 (esquemas Finance/Audit/Agent), #5 (Auth), #12 (Android)
- **Relacionado:** [ADR 002 — Redis Broker](002-transporte-redis.md), [ADR 003 — Dinero](003-dinero.md)

## Contexto

El monorepo tiene dos desarrolladores y varios consumidores del mismo contrato: el API Gateway, los microservicios, los tests de integración y la app Android. Si cada servicio define sus propios DTOs, patrones de mensajes o tipos monetarios, aparecen divergencias silenciosas y retrabajo.

`packages/contracts` ya contiene los DTOs de Auth/Finance/Agent/Audit y los mapas `AuthPatterns`, `FinancePatterns`, `AgentPatterns` y `AuditEvents`. Este ADR congela la primera versión y define cómo evolucionarla.

## Decisión

### 1. Fuente única de verdad

- Todos los DTOs de entrada/salida, enums, patrones RPC y eventos viven en `packages/contracts`.
- Las apps importan desde `@mybusiness/contracts`; no redefinen DTOs ni copian strings de patrones.
- Los nombres de patrones se declaran una sola vez en `src/patterns/index.ts` y se consumen como constantes.
- Los enums de TypeScript deben coincidir con los enums de PostgreSQL definidos en cada `schema.ts`; cualquier cambio se revisa en ambos lados.

### 2. Convenciones de nombres

- Entrada HTTP/RPC: `Create*Dto`, `Update*Dto`, `*QueryDto`.
- Salida: `*Response` o interfaces de dominio explícitas.
- Importes: `*Minor` y `currency`, según [ADR 003](003-dinero.md).
- Fechas: ISO 8601 en UTC, transportadas como `string`.
- IDs: UUID como `string`; no se envían objetos de persistencia completos.
- Patrones RPC: `dominio.accion` (`auth.login`, `finance.transactions.create`).
- Eventos: `dominio.evento_en_pasado` (`audit.log_event`), con payload explícito y versionable.

### 3. Validación y límites de confianza

- El API Gateway valida los DTOs de entrada con `class-validator`.
- Los microservicios no confían ciegamente en el Gateway: validan sus payloads y aplican sus propias reglas de dominio.
- Los contratos no contienen URLs, puertos, credenciales ni rutas de infraestructura; esos valores se resuelven por configuración (`process.env`/`ConfigService`).
- No se permite `any` en un contrato público si existe un tipo compartido; los mocks internos pueden usar tipos temporales, pero deben migrarse al contrato.

### 4. Versionado y cambios incompatibles

- Los cambios aditivos (nuevo campo opcional, nuevo patrón) son compatibles y se documentan en el PR.
- Renombrar/eliminar un campo, cambiar su tipo o hacer obligatorio un campo opcional es un cambio incompatible.
- Un cambio incompatible requiere:
  1. Nuevo patrón versionado o nuevo DTO (`*V2`), manteniendo el anterior durante la transición.
  2. Actualización coordinada de productor, consumidor(es), Gateway, tests y app Android.
  3. Nota en el issue correspondiente y enlace al ADR/PR.
- No se reutiliza un nombre de patrón con un payload incompatible.

### 5. Pruebas de contrato

- `pnpm build` debe compilar `packages/contracts` antes que las apps.
- Cada cambio de contrato debe incluir al menos una prueba de serialización/validación o un test de integración que use el patrón real.
- Los tests de integración de Redis y los tests de Android deben consumir los mismos DTOs, no copias locales.
- Los contratos monetarios se prueban con importes que superen `Number.MAX_SAFE_INTEGER` y con monedas de distinta escala.

## Consecuencias

**Positivas**

- Un solo lugar para entender la interfaz entre equipos.
- Menos errores de integración entre Auth/Finance/Gateway/Android.
- Los cambios incompatibles quedan visibles y coordinados.

**Negativas / a vigilar**

- `packages/contracts` se vuelve un punto de coordinación obligatorio; un cambio mal comunicado bloquea a ambos desarrolladores.
- Mantener enums de TS y PostgreSQL sincronizados sigue siendo manual.
- El versionado de patrones añade complejidad cuando haya cambios de dominio reales.

## Alternativas descartadas

- **DTOs duplicados por servicio:** deriva inevitable y bugs de integración.
- **Contratos generados desde OpenAPI en esta fase:** útil más adelante, pero añade tooling y un paso de generación antes de estabilizar el dominio.
- **Strings de patrones inline:** impiden refactors seguros y oculten consumidores.
- **Contratos con credenciales o URLs:** filtran infraestructura y acoplan el contrato al entorno.

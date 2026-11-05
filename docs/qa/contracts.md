# Gestión de Contratos OpenAPI, Tipado Web y Verificación Kotlin (Issue #54)

Este documento detalla la arquitectura de contratos de API en el monorepo MyBusiness, las garantías de determinismo, la detección de desviaciones (_drift_) en integración continua (CI) y la sincronización entre backend, frontend web y aplicación móvil Android (Kotlin).

---

## 1. El OpenAPI como Fuente de Verdad

En la arquitectura de MyBusiness, la especificación **OpenAPI 3.0** es el único contrato formal y la fuente de verdad (_Single Source of Truth_) para todas las interfaces HTTP expuestas por el perímetro de la plataforma (`apps/api-gateway`).

- **Ubicación versionada**: `docs/openapi/api-gateway.json`
- **Script de generación**: `scripts/generate-openapi.mjs`
- **Comando raíz**:
  ```bash
  pnpm contracts:generate
  ```

### Garantías de Determinismo

Para evitar _flapping_ o diferencias espurias en Git entre distintas máquinas o sistemas operativos:

1. **Ordenamiento canónico de claves**: Todas las claves de objetos y diccionarios se ordenan alfabéticamente de manera recursiva antes de la serialización JSON.
2. **Formato uniforme**: JSON indentado a 2 espacios con saltos de línea consistentes.
3. **Ausencia de datos de entorno**: Se suprimen timestamps de compilación, rutas absolutas del host y valores derivados de variables de entorno volátiles.
4. **Enriquecimiento dinámico de esquemas**: Los DTOs compartidos de `@mybusiness/contracts` son enriquecidos dinámicamente en tiempo de generación con decoradores `@ApiProperty` basados en los metadatos de `class-validator`, garantizando esquemas detallados (`properties`, `required`, formatos) sin acoplar los paquetes base con `@nestjs/swagger`.
5. **Aislamiento de infraestructura**: El generador inicializa `AppModule` con variables de entorno dummy, sin abrir conexiones vivas a PostgreSQL ni Redis, y cierra la aplicación inmediatamente (`app.close()`). Los endpoints internos de salud (`/health`, `/healthz`, `/metrics`) y la propia interfaz gráfica `/docs` se omiten para mantener el contrato enfocado exclusivamente en las APIs de producto.

---

## 2. Tipos del Cliente Web (Next.js)

El frontend web (`apps/web`) consume el contrato OpenAPI para inferir estáticamente todos los tipos de respuesta y peticiones HTTP hacia el BFF y el API Gateway.

- **Herramienta**: `openapi-typescript` v7
- **Archivo generado y versionado**: `apps/web/lib/generated/api-schema.d.ts`
- **Script del paquete web**:
  ```bash
  pnpm --filter @mybusiness/web contracts:generate
  ```
- **Exclusiones de Calidad**: El archivo generado se excluye deliberadamente de análisis de formato y estilo para evitar falsos positivos:
  - ESLint: Excluido en `apps/web/eslint.config.mjs` (`lib/generated/**`).
  - Prettier: Excluido en `.prettierignore` (`apps/web/lib/generated/**`).
  - SonarCloud: Excluido mediante `sonar.exclusions` en `.github/workflows/web-ci.yml`.

---

## 3. Verificación de Drift en CI

Para prevenir que cambios en los controladores o DTOs del backend queden desfasados respecto a los artefactos versionados, se implementó el verificador de drift:

- **Script**: `scripts/check-contracts.mjs`
- **Comando raíz**:
  ```bash
  pnpm contracts:check
  ```
- **Mecanismo de funcionamiento**:
  1. Regenera en memoria / directorio temporal (`node_modules/.cache/contracts-check/`) la especificación OpenAPI y los tipos TypeScript del cliente web.
  2. Compara byte a byte los archivos temporales generados contra las versiones versionadas en Git (`docs/openapi/api-gateway.json` y `apps/web/lib/generated/api-schema.d.ts`).
  3. Si existe discrepancia:
     - Escribe el reporte de diferencias detallado en `contracts-drift.diff`.
     - Finaliza con código de salida `1` (`process.exit(1)`).
  4. En GitHub Actions (`ci.yml` y `web-ci.yml`), el job `contracts` ejecuta este script y, ante fallos, sube `contracts-drift.diff` como artefacto de depuración (`actions/upload-artifact`).

---

## 4. Verificación de Modelos Kotlin (Mobile Android)

Dado que la aplicación Android (`apps/mobile-android`) mantiene modelos Kotlin escritos manualmente (`core/model` y `core/network/.../dto`), la verificación de contratos se realiza mediante una comprobación ligera y determinista en Node.js, sin introducir Java ni el OpenAPI Generator pesado en el pipeline.

- **Esquema de configuración**: `contracts/kotlin-contract-map.schema.json`
- **Mapa declarativo**: `contracts/kotlin-contract-map.json`
- **Script de validación**: `scripts/check-kotlin-contracts.mjs`
- **Comando raíz**:
  ```bash
  pnpm contracts:check:kotlin
  ```

### Lógica de Validación

1. El script analiza sintácticamente las clases `data class` de Kotlin eliminando comentarios y extrayendo sus propiedades (`val` / `var`).
2. Cruza cada modelo Kotlin mapeado contra su correspondiente esquema en `docs/openapi/api-gateway.json`.
3. Valida paridad bidireccional:
   - **Campos del esquema OpenAPI**: Cada propiedad declarada en el esquema OpenAPI debe existir en el modelo Kotlin, a menos que esté explícitamente listada en `allowlistSchemaFields` con una razón justificada.
   - **Campos del modelo Kotlin**: Cada propiedad de Kotlin debe existir en el esquema OpenAPI, a menos que esté explícitamente listada en `allowlistKotlinFields` (por ejemplo, campos derivados en cliente o metadatos de UI).
4. Si un DTO mapeado no existe en disco, si falta un campo no justificado o si hay inconsistencias de nomenclatura (camelCase / snake_case), el script emite un error detallado y aborta con código `1`.

### Alcance y Limitaciones

- **Alcance**: Garantiza que ningún cambio en los endpoints rompa silenciosamente la deserialización de modelos en Android ni omita campos obligatorios.
- **Limitaciones**: No comprueba tipos genéricos anidados profundos ni herencia polimórfica compleja en Kotlin; se enfoca en integridad de campos, presencia y consistencia de atributos serializables.

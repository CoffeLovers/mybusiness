# Migración de CI/CD: GitHub Actions → GitLab CI/CD

> Documento de trabajo de la migración de la integración y el despliegue continuo del monorepo
> `mybusiness` desde GitHub Actions hacia GitLab CI/CD.
> Estado: **propuesta** · Rama: `docs/gitlab-migration` · Fuente de issues: [`ISSUES.md`](./ISSUES.md)

---

## 1. Objetivo y alcance

### Objetivo

Replicar en GitLab CI/CD, sin pérdida de cobertura ni de garantías, todo lo que hoy ejecutan los
workflows de `.github/workflows/`, y aprovechar las capacidades nativas de GitLab para reducir el
mantenimiento (seguridad integrada, entornos, merge trains, schedules, releases).

Criterio de paridad: **todo job bloqueante en GitHub debe tener un job bloqueante equivalente en
GitLab**; un merge a `develop` solo debe ser posible con el pipeline verde y con el mismo conjunto de
comprobaciones (lint, formato, tipos, tests, contratos, build, E2E, a11y, seguridad, Sonar).

### Dentro del alcance

- 6 workflows: `ci.yml`, `web-ci.yml`, `security.yml`, `android.yml`, `load-test.yml`, `web-cd.yml`.
- Pipeline `.gitlab-ci.yml` completo, runners, cachés, artefactos y reglas de ejecución.
- Registry de imágenes (sustitución de GHCR) y despliegues SSH a staging/producción con rollback.
- Gestión de variables y secretos (masked / protected / file).
- Automatizaciones: schedules, Renovate, merge trains, auto-merge, releases por tag, notificaciones.
- Cutover, espejo GitHub→GitLab y runbook de reversión.

### Fuera de alcance

- Migración del historial de issues, MRs, milestones y labels de GitHub (opcional; ver §9).
- Sustitución de SonarCloud por SonarQube self-managed (se mantiene SonarCloud, ver §3).
- Migración de repositorio de paquetes npm, wiki o GitHub Pages (no existen en este repo).
- Cambios funcionales en la aplicación, en los Dockerfiles o en el stack de `docker/docker-compose.yml`.
- Cambio de proveedor de cloud/hosting: los deploys siguen siendo SSH + Docker en los mismos hosts.

---

## 2. Estado actual

Repositorio: `CoffeLovers/mybusiness`. Ramas: `develop` (integración) y `main` (espejo de release,
avance solo por fast-forward, ver `CONTRIBUTING.md`).

| Workflow        | Disparadores                                            | Jobs                                                                          |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ci.yml`        | push y PR a `main`, `develop`                           | `lint`, `format`, `typecheck`, `test`, `contracts`, `build`, `test-e2e`       |
| `web-ci.yml`    | push y PR a `develop`/`main` con `paths` de web         | `quality`, `contracts`, `e2e` (Playwright), `a11y` (axe), `security`, `sonar` |
| `security.yml`  | push y PR a `main`, `develop`                           | `trivy-fs`, `sonarcloud`                                                      |
| `android.yml`   | push y PR con `paths` de `apps/mobile-android/**`       | `build` (JDK 17 + Gradle: unit tests + `assembleDebug`)                       |
| `load-test.yml` | `workflow_dispatch` y PR con `paths` de `tests/load/**` | `ingest-50k` (k6 + verificación PostgreSQL)                                   |
| `web-cd.yml`    | push a `develop`/`main` con `paths` de web              | `build` (push GHCR), `deploy-staging` (SSH), `deploy-production` (SSH manual) |

Detalle por job:

| Job               | Qué hace                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint`            | `pnpm lint` (ESLint 9, `--max-warnings=0`).                                                                                                                                                |
| `format`          | `pnpm format:check` (Prettier).                                                                                                                                                            |
| `typecheck`       | Build de `packages/*` + `tsc --build --noEmit` + typecheck de web y scripts. `needs: [lint, format]`.                                                                                      |
| `test`            | `pnpm test` (Jest/Vitest de backend y packages, excluye web). `needs: [lint, format]`.                                                                                                     |
| `contracts`       | Build de `contracts`, `common`, `api-gateway`; `contracts:check` y `contracts:check:kotlin`; artifact de drift al fallar.                                                                  |
| `build`           | `pnpm build` de todo el monorepo. `needs: [typecheck, test, contracts]`.                                                                                                                   |
| `test-e2e`        | Migraciones y E2E con 3 PostgreSQL (finance 5432, agent pgvector 5433, audit 5434) + Redis 7 con password.                                                                                 |
| `quality`         | Lint, Prettier, contraste de tokens, typecheck, tests con cobertura y build de `@mybusiness/web` (timeout 10 min).                                                                         |
| `contracts` (web) | Igual que el de `ci.yml`, con `needs` propio dentro del workflow.                                                                                                                          |
| `e2e`             | Playwright (`playwright install --with-deps chromium`) sobre el build de web; publica reporte, resultados y diffs.                                                                         |
| `a11y`            | `playwright test e2e/accessibility.spec.ts` (axe).                                                                                                                                         |
| `security`        | Build de `apps/web/Dockerfile` + Trivy a la imagen (tabla bloqueante, SARIF como artifact).                                                                                                |
| `sonar`           | Descarga cobertura y ejecuta SonarCloud con `SONAR_TOKEN` (se omite si el token no existe).                                                                                                |
| `trivy-fs`        | Trivy filesystem en SARIF + subida a code scanning.                                                                                                                                        |
| `android:build`   | `./gradlew :core:designsystem:testDebugUnitTest :core:common:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug` (timeout 30 min).                                                |
| `ingest-50k`      | Levanta el stack real (`docker compose` con Postgres/Redis), migra, siembra, arranca servicios, corre k6 (100k throttles) y verifica paridad `audit_logs`/`transactions` (timeout 75 min). |
| `web-cd:build`    | Buildx + push a GHCR con tags `sha` y nombre de rama, cache `type=gha`.                                                                                                                    |
| `deploy-*`        | Pull de la imagen, reemplazo del contenedor, smoke `/healthz` + `/login`, rollback al tag anterior si el smoke falla.                                                                      |

---

## 3. Decisiones previas

| Tema                | Decisión                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plataforma          | **GitLab.com (SaaS)**. Self-managed queda descartado: no hay requisito de residencia de datos y añadiría operación de upgrades, backups y HA sin beneficio. Si en el futuro aparece ese requisito, el pipeline es portable.                                       |
| Repositorio         | Import con historial completo (espejo de `main` y `develop`), proyecto en el grupo correspondiente, `develop` como **rama por defecto**.                                                                                                                          |
| Protección de ramas | `develop`: no-force-push, sin borrado, merge solo con pipeline verde. `main`: protegida, **ff-only**, empuje reservado a maintainers; los releases entran por MR desde `develop` con fast-forward.                                                                |
| Runners             | Linux con executor **Docker**. Android requiere runner propio o imagen dedicada (JDK 17 + Android SDK 35); los shared runners no garantizan ni disco ni tiempo (ver §7).                                                                                          |
| Registry            | **GitLab Container Registry** (`$CI_REGISTRY_IMAGE`) en lugar de GHCR. Autenticación con `CI_JOB_TOKEN` (gratis, efímero, sin PAT).                                                                                                                               |
| Imágenes base       | Node 20 para jobs pnpm (coherente con `actions/setup-node@20`), `gradle:8-jdk17` + SDK 35 para Android, `docker:27` + BuildKit para build de imágenes. Nótese que `apps/web/Dockerfile` construye con `node:22-bookworm-slim`: el runtime de la imagen no cambia. |
| Caché               | Cache de GitLab por job, no compartida entre runners: store de pnpm, `~/.gradle` y capas Docker vía cache de registry (`type=registry`), que sí sobrevive entre runners.                                                                                          |
| Secretos            | Variables de proyecto/grupo **masked** y **protected** (solo ramas/tags protegidos) y **file** para claves SSH. Nada de secretos en el YAML. Los de staging/producción viven en _environments_ distintos.                                                         |
| Sonar               | **Se mantiene SonarCloud** (`CoffeLovers_mybusiness`, org `coffeelovers`) con `sonar-scanner` en un job; no se adopta SonarQube self-managed en esta migración.                                                                                                   |
| Seguridad           | Se conserva Trivy (FS e imagen) y se añaden los analizadores nativos de GitLab (SAST, Dependency Scanning, Container Scanning) como capa extra, no como sustituto.                                                                                                |
| Equivalencias       | `concurrency` → `interruptible` + `resource_group`; `paths` → `rules:changes`; `needs` → `needs` (DAG); `environments` → `environment`; `vars` → variables de GitLab.                                                                                             |

---

## 4. Fases

| Fase | Nombre              | Objetivo                                                            | Entregable                                                      | Criterio de salida                                                                  |
| ---- | ------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0    | Decisiones y ADR    | Cerrar plataforma, runners, registry y modelo de secretos           | `docs/adr/0xx-ci-cd-gitlab.md` + inventario de secretos         | ADR aprobado; nadie empieza a escribir YAML con dudas abiertas                      |
| 1    | Espejo y esqueleto  | Proyecto importado y pipeline mínimo que pasa en `develop`          | Repo espejo, ramas protegidas, `.gitlab-ci.yml` con `validate`  | Pipeline verde en un MR de prueba; `main` protegida ff-only                         |
| 2    | Paridad backend     | `validate`/`test`/`contracts`/`build`/`e2e` equivalentes a `ci.yml` | Jobs `backend:*` con services, caché y artefactos               | MR de prueba reproduce los 7 jobs y bloquea el merge si uno falla                   |
| 3    | Paridad web         | `quality`, `contracts`, `e2e`, `a11y` de `web-ci.yml`               | Jobs `web:*` con `rules:changes` y artefactos Playwright        | E2E y a11y verdes; diffs visuales descargables al fallar                            |
| 4    | Android             | Runner/imagen Android y job Gradle                                  | Job `android:build` + imagen del runner                         | `assembleDebug` bajo 25 min con caché caliente y APK como artifact                  |
| 5    | Seguridad y calidad | Trivy, SonarCloud y analizadores nativos                            | Jobs `security:*` y `sonar`                                     | SARIF descargable, `SONAR_TOKEN` protegido, quality gate aplicado                   |
| 6    | CD                  | Registry, staging automático, producción manual y rollback          | Jobs `package:web` y `deploy:*` con `environment`               | Deploy a staging por merge a `develop`; producción con aprobación; rollback probado |
| 7    | Automatizaciones    | Schedules, Renovate, merge trains, releases y notificaciones        | Config de schedules + `renovate.json` + `.gitlab/ci/notify.yml` | Nightly y load-test semanal ejecutados al menos una vez; aviso recibido             |
| 8    | Cutover y rollback  | Congelar GitHub Actions y operar solo en GitLab                     | Runbook de cutover, doble push y verificación de paridad        | 2 semanas de doble push sin incidencias; Actions desactivado                        |

---

## 5. Mapeo GitHub → GitLab

Convenciones de imagen: `node:20-bookworm-slim` con corepack para pnpm 12.9.1; `docker:27` para las
fases de imagen; `gradle:8-jdk17` (o runner propio) para Android.

En GitLab **los servicios no se publican en `127.0.0.1`**: se resuelven por su alias de red. Los
`*_DATABASE_URL` y `REDIS_HOST` deben apuntar a `postgres`, `postgres-agent`, `postgres-audit` y
`redis`, nunca a `localhost`.

### 5.1 `ci.yml`

| Job GitHub  | Job GitLab          | Stage      | `image`                 | `services`                                                                                                 | `cache`                       | `artifacts`                               | `rules`                                               | `needs`                          |
| ----------- | ------------------- | ---------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| `lint`      | `backend:lint`      | `validate` | `node:20-bookworm-slim` | —                                                                                                          | pnpm store (`pnpm-lock.yaml`) | —                                         | MR + push a `develop`/`main`                          | —                                |
| `format`    | `backend:format`    | `validate` | `node:20-bookworm-slim` | —                                                                                                          | pnpm store                    | —                                         | MR + push                                             | —                                |
| `typecheck` | `backend:typecheck` | `validate` | `node:20-bookworm-slim` | —                                                                                                          | pnpm store                    | —                                         | MR + push                                             | `backend:lint`, `backend:format` |
| `test`      | `backend:test`      | `test`     | `node:20-bookworm-slim` | —                                                                                                          | pnpm store                    | `coverage/lcov.info`, `junit.xml`         | MR + push                                             | `backend:lint`, `backend:format` |
| `contracts` | `backend:contracts` | `test`     | `node:20-bookworm-slim` | —                                                                                                          | pnpm store                    | `contracts-drift.diff`, `docs/openapi/**` | MR + push                                             | `backend:lint`, `backend:format` |
| `build`     | `backend:build`     | `build`    | `node:20-bookworm-slim` | —                                                                                                          | pnpm store                    | `dist/**` (7 días)                        | MR + push                                             | typecheck, test, contracts       |
| `test-e2e`  | `backend:e2e`       | `e2e`      | `node:20-bookworm-slim` | `postgres` (16-alpine), `postgres-agent` (pgvector/pg16), `postgres-audit` (16-alpine), `redis` (7-alpine) | pnpm store + `apps/**/dist`   | `junit.xml`, logs de migración al fallar  | MR + push; además `$CI_PIPELINE_SOURCE == "schedule"` | `backend:build`                  |

Notas de implementación:

- Los cuatro servicios usan `alias` explícito y variables `POSTGRES_USER/PASSWORD/DB` por servicio
  (finance, agent, audit) más `REDIS_PASSWORD` vía `command: redis-server --requirepass test_password`.
- GitLab no ejecuta _health checks_ de servicios: el job hace un bucle `pg_isready` / `redis-cli ping`
  (cliente instalado con `apt-get install -y postgresql-client redis-tools`) con reintentos acotados.
  Un `wait-for-services` en `.before_script` evita el `sleep` ciego.
- `pnpm install --frozen-lockfile` se hace con `store-dir=$CI_PROJECT_DIR/.pnpm-store` para que el
  cache sea portable entre runners.
- `psql "$AGENT_DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'` se mantiene (la imagen
  `pgvector/pgvector:pg16` ya la trae, pero el job no debe asumirlo).

### 5.2 `web-ci.yml`

| Job GitHub  | Job GitLab        | Stage      | `image`                                                                                              | `services` | `cache`                             | `artifacts`                                                                            | `rules:changes`                                                                         | `needs`                        |
| ----------- | ----------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| `quality`   | `web:quality`     | `validate` | `node:20-bookworm-slim`                                                                              | —          | pnpm store + `apps/web/.next/cache` | `apps/web/coverage/lcov.info`                                                          | `apps/web/**`, `packages/{contracts,common}/**`, `pnpm-lock.yaml`, `.gitlab/ci/web.yml` | —                              |
| `contracts` | `web:contracts`   | `test`     | `node:20-bookworm-slim`                                                                              | —          | pnpm store                          | `contracts-drift.diff`                                                                 | mismas rutas + `docs/openapi/**`, `scripts/**`                                          | —                              |
| `e2e`       | `web:e2e`         | `e2e`      | `mcr.microsoft.com/playwright:v1.5x-jammy` (o `node:20` + `playwright install --with-deps chromium`) | —          | pnpm store + `.next/cache`          | `playwright-report/`, `test-results/`, `**/*-diff.png`, `**/*-actual.png`, `junit.xml` | igual que `quality`                                                                     | `web:quality`, `web:contracts` |
| `a11y`      | `web:a11y`        | `e2e`      | ídem `web:e2e`                                                                                       | —          | pnpm store                          | `playwright-report/`, `test-results/`                                                  | `apps/web/**`, `docs/design/**`                                                         | `web:quality`                  |
| `security`  | `web:trivy-image` | `security` | `docker:27`                                                                                          | —          | capas Docker vía registry           | `trivy-web.sarif`                                                                      | `apps/web/**`, `Dockerfile`                                                             | `web:quality`                  |
| `sonar`     | `web:sonar`       | `security` | `sonarsource/sonar-scanner-cli`                                                                      | —          | —                                   | —                                                                                      | `apps/web/**`; `if: $SONAR_TOKEN`                                                       | `web:quality`                  |

Notas:

- `timeout: 10 minutes` → `timeout: 10m` en `quality`/`contracts`/`security`/`sonar`; `15m` en `e2e`/`a11y`.
- Si se usa imagen Playwright oficial, la versión del tag **debe** coincidir con la de
  `@playwright/test` en `apps/web/package.json`; si no, se cae a `node:20` +
  `pnpm --filter @mybusiness/web exec playwright install --with-deps chromium`.
- `web:e2e` publica `junit.xml` vía `artifacts:reports:junit` para que GitLab muestre los fallos test a test.
- `web:trivy-image` construye con `docker build -f apps/web/Dockerfile -t $CI_REGISTRY_IMAGE/web:$CI_COMMIT_SHORT_SHA .`
  y reutiliza la cache de registry de `package:web` cuando exista.

### 5.3 `security.yml`, `android.yml`, `load-test.yml`

| Job GitHub      | Job GitLab          | Stage      | `image`                                                  | `services`                                         | `cache`                                 | `artifacts`                                        | `rules`                                                               | `needs`        |
| --------------- | ------------------- | ---------- | -------------------------------------------------------- | -------------------------------------------------- | --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| `trivy-fs`      | `security:trivy-fs` | `security` | `aquasec/trivy:latest`                                   | —                                                  | —                                       | `trivy-fs.sarif` (reports:sast)                    | MR + push a `develop`/`main` + schedule mensual                       | —              |
| `sonarcloud`    | `backend:sonar`     | `security` | `sonarsource/sonar-scanner-cli`                          | —                                                  | pnpm store                              | —                                                  | push a `develop`/`main`; `if: $SONAR_TOKEN`                           | `backend:test` |
| `android:build` | `android:build`     | `build`    | `$ANDROID_IMAGE` (JDK 17 + SDK 35)                       | —                                                  | `~/.gradle/caches`, `~/.gradle/wrapper` | `app-debug.apk`, reportes de test, `lint-results`  | `rules:changes: apps/mobile-android/**`                               | —              |
| `ingest-50k`    | `load:ingest-50k`   | `e2e`      | `grafana/k6` + `docker:27` (o runner propio con compose) | ninguno (el stack se levanta con `docker compose`) | pnpm store                              | `k6-summary.json`, `verification-54.json`, `*.log` | `web` (manual) + PR con cambios en `tests/load/**` + schedule semanal | —              |

Notas:

- `load:ingest-50k` es el job más caro (75 min, `docker compose` con 4 servicios y ~50k peticiones).
  Requiere un runner con Docker-in-Docker o socket montado; en shared runners es inviable por tiempo.
  Se marca `rules: - when: manual` con `allow_failure: true` en MR y automático en schedule semanal.
- `android:build` replica el `working-directory` con `before_script: cd apps/mobile-android` y
  `chmod +x gradlew`.

### 5.4 `web-cd.yml`

| Job GitHub          | Job GitLab          | Stage     | `image`       | `cache`                             | `artifacts`        | `environment`                        | `rules`                                   | `needs`       |
| ------------------- | ------------------- | --------- | ------------- | ----------------------------------- | ------------------ | ------------------------------------ | ----------------------------------------- | ------------- |
| `build`             | `package:web`       | `package` | `docker:27`   | BuildKit `type=registry` (`:cache`) | `image-digest.txt` | —                                    | push a `develop`/`main` con `changes` web | —             |
| `deploy-staging`    | `deploy:staging`    | `deploy`  | `alpine:3.20` | —                                   | `deploy.log`       | `staging`, `url: $STAGING_URL`       | push a `develop` (auto)                   | `package:web` |
| `deploy-production` | `deploy:production` | `deploy`  | `alpine:3.20` | —                                   | `deploy.log`       | `production`, `url: $PRODUCTION_URL` | push a `main` (manual, `when: manual`)    | `package:web` |

El script SSH se mantiene idéntico en semántica al de `appleboy/ssh-action`:

1. `docker login $CI_REGISTRY -u $CI_REGISTRY_USER -p $CI_JOB_TOKEN`.
2. Guardar la imagen del contenedor actual (`docker inspect --format '{{.Config.Image}}'`) en
   `/tmp/mybusiness-web-previous`.
3. `docker rm -f` + `docker run -d --restart unless-stopped -p 3000:3000` (staging) o `-p 3001:3000`
   (producción) con `-e NODE_ENV=production`.
4. `sleep 30` + `curl -fsS http://127.0.0.1:<puerto>/healthz`.
5. Si el smoke falla: relanzar la imagen anterior y salir con código ≠ 0.
6. Smoke externo: `$STAGING_URL/healthz` y `/login` debe devolver 200.

El tag de la imagen es `$CI_COMMIT_SHA` (equivalente a `type=sha,format=long`) más `$CI_COMMIT_REF_SLUG`
para trazabilidad. `retry: 2` en los deploys por fallos de red SSH.

---

## 6. Variables y secretos

| Nombre               | Tipo              | Protegida | Entornos          | Uso                                                       | Origen GitHub                                         |
| -------------------- | ----------------- | --------- | ----------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `SONAR_TOKEN`        | Variable (masked) | Sí        | todos             | `sonar-scanner` en `backend:sonar` y `web:sonar`          | `secrets.SONAR_TOKEN`                                 |
| `STAGING_HOST`       | Variable          | Sí        | `staging`         | Host SSH del deploy de staging                            | `secrets.STAGING_HOST`                                |
| `STAGING_USER`       | Variable          | Sí        | `staging`         | Usuario SSH                                               | `secrets.STAGING_USER`                                |
| `STAGING_SSH_KEY`    | **File** (masked) | Sí        | `staging`         | `ssh -i "$STAGING_SSH_KEY"`                               | `secrets.STAGING_SSH_KEY`                             |
| `STAGING_URL`        | Variable          | No        | `staging`         | `environment.url` y smoke externo                         | `vars.STAGING_URL`                                    |
| `PRODUCTION_HOST`    | Variable          | Sí        | `production`      | Host SSH del deploy de producción                         | `secrets.PRODUCTION_HOST`                             |
| `PRODUCTION_USER`    | Variable          | Sí        | `production`      | Usuario SSH                                               | `secrets.PRODUCTION_USER`                             |
| `PRODUCTION_SSH_KEY` | **File** (masked) | Sí        | `production`      | `ssh -i "$PRODUCTION_SSH_KEY"`                            | `secrets.PRODUCTION_SSH_KEY`                          |
| `PRODUCTION_URL`     | Variable          | No        | `production`      | `environment.url` y smoke externo                         | `vars.PRODUCTION_URL`                                 |
| `CI_JOB_TOKEN`       | Predefinida       | —         | todos             | Login al Container Registry y a la API de paquetes        | **Nueva** (sustituye `GITHUB_TOKEN` para el registry) |
| `GITLAB_TOKEN`       | Variable (masked) | Sí        | `main` y tags     | Releases, creación de MRs de Renovate, consultas a la API | **Nueva** (PAT con `api`, `write_repository`)         |
| `SLACK_WEBHOOK_URL`  | Variable (masked) | Sí        | `develop`, `main` | Notificaciones de deploy y pipeline fallido (opcional)    | — (nuevo)                                             |

Reglas:

- **Qué se elimina:** `GITHUB_TOKEN` (GitLab emite `CI_JOB_TOKEN` por job, sin gestión manual), las
  credenciales de GHCR (`GITHUB_ACTOR` + token) y `GITHUB_STEP_SUMMARY` (se sustituye por
  `artifacts:reports:*` y `$CI_JOB_SUMMARY`, o por un `echo` en el log).
- **Qué se conserva:** `SONAR_TOKEN` y los cuatro secretos de deploy, sin rotar durante el espejo; la
  rotación ocurre en el cutover (§9).
- Las variables **protected** solo se inyectan en pipelines de ramas/tags protegidos. `develop` y
  `main` están protegidas, por lo que los jobs de deploy funcionan, pero un MR de fork o una rama no
  protegida no recibe ningún secreto.
- Los secretos de staging y producción **no se comparten**: cada uno vive en su _environment_
  (`deploy:staging` vs `deploy:production`), de modo que un job de staging no puede leer los de producción.
- `STAGING_SSH_KEY` y `PRODUCTION_SSH_KEY` se cargan como **File**: el runner escribe la clave en un
  archivo temporal con permisos 0400 y exporta la ruta; nunca se interpola el contenido en el YAML.
- Las claves se generan por entorno y por usuario de despliegue (`gitlab-ci@staging`), no se reutilizan
  las de GitHub; se revocan las antiguas tras el cutover.
- `masked` exige ≥ 8 caracteres sin saltos de línea: los tokens cumplen; si alguno no, se guarda como
  File con permisos restringidos.
- No se añaden secretos al `.env` del load-test: usa credenciales de prueba efímeras, igual que hoy.

---

## 7. Runners

| Job(s)                                    | vCPU | RAM  | Disco | Notas                                                                       |
| ----------------------------------------- | ---- | ---- | ----- | --------------------------------------------------------------------------- |
| `backend:lint/format/typecheck/contracts` | 2    | 4 GB | 20 GB | Shared runner suficiente.                                                   |
| `backend:test`, `backend:build`           | 4    | 8 GB | 30 GB | `tsc --build` del monorepo es intensivo en RAM.                             |
| `backend:e2e`                             | 4    | 8 GB | 40 GB | 4 servicios + build; con 2 vCPU el job roza el timeout.                     |
| `web:quality`, `web:contracts`            | 2    | 4 GB | 25 GB | Cache de Next.js ayuda, pero no sustituye CPU en `next build`.              |
| `web:e2e`, `web:a11y`                     | 2–4  | 4 GB | 25 GB | Chromium headless; 15 min de presupuesto.                                   |
| `android:build`                           | 4    | 8 GB | 60 GB | **Runner propio**: JDK 17 + Android SDK 35 + Gradle cache. Ver abajo.       |
| `load:ingest-50k`                         | 4    | 8 GB | 80 GB | Docker-in-Docker o socket; 75 min; idealmente runner dedicado de madrugada. |
| `package:web`                             | 4    | 8 GB | 40 GB | BuildKit con cache de registry.                                             |
| `deploy:*`                                | 1    | 1 GB | 10 GB | Solo cliente SSH.                                                           |

### Android

- Imagen dedicada (o runner con imagen propia): `eclipse-temurin:17-jdk` + `cmdline-tools` +
  `platforms;android-35`, `build-tools;35.0.0`, `platform-tools`, `emulator` **no** necesario
  (no hay tests instrumentados en el pipeline actual).
- `ANDROID_HOME=/opt/android-sdk`, `GRADLE_USER_HOME=$CI_PROJECT_DIR/.gradle`.
- Cache Gradle: `key: files: [apps/mobile-android/**/*.gradle*, apps/mobile-android/gradle/wrapper/gradle-wrapper.properties]`,
  `paths: [.gradle/caches, .gradle/wrapper]`. Una cache fría de Gradle son ~6–8 min extra.
- **Por qué los shared runners no bastan**: el SLA de disco es limitado (SDK + caches + APK superan
  los 25 GB con holgura), la cuota mensual de minutos se consume rápido (un build Android ≈ 10–20 min
  × 2 ramas × N MRs), no hay garantía de imagen con SDK 35 y el `timeout` por job es menor al deseado.
- `resource_group: android` para serializar builds y no fragmentar la cache entre ejecuciones paralelas.

### Self-hosted vs GitLab-hosted

Recomendación: shared runners para todo lo Node/Playwright; **un runner self-hosted Docker** (8 vCPU /
16 GB / 200 GB SSD) para Android y load-test, registrado a nivel de proyecto con tag `heavy` y
`run_untagged: false`.

---

## 8. Automatizaciones

| Automatización    | Implementación                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Nightly E2E       | Pipeline schedule diario 03:00 UTC sobre `develop` con `BACKEND_E2E=1`, que también ejecuta conciliación y contratos.                           |
| Load test semanal | Schedule domingo 04:00 UTC con `LOAD_FULL=1`: ejecuta `load:ingest-50k` en modo FULL (no SMOKE).                                                |
| Audit mensual     | Schedule día 1 05:00 UTC: `security:trivy-fs`, `security:trivy-image`, Dependency Scanning y `pnpm audit`.                                      |
| Renovate          | `renovate.json` con `extends: ["config:recommended"]`, agrupación de `@typescript-eslint/*`, `nestjs`, `next`, `gradle`; MRs contra `develop`.  |
| Merge trains      | Activado en `develop` para que varios MRs verdes se integren en serie sin re-ejecutar todo el pipeline desde cero.                              |
| Auto-merge        | Solo con pipeline verde y aprobación; `merge_when_pipeline_succeeds` en MRs de Renovate y `docs/*`.                                             |
| Review apps       | Opcional: `deploy:review` por MR con `environment: review/$CI_COMMIT_REF_SLUG`, `on_stop` y TTL de 3 días (requiere host de review).            |
| Releases por tag  | Job `release` en `rules: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/` que publica nota con `release-cli` y el APK/imagen asociados.                    |
| Notificaciones    | Job `notify` (`when: always`) que envía a Slack (`SLACK_WEBHOOK_URL`) y, para producción, a Telegram; incluye URL de pipeline y de environment. |
| `interruptible`   | `true` por defecto; `false` en `deploy:*`, `package:*`, `load:*` y `release`.                                                                   |
| `resource_group`  | `deploy/staging`, `deploy/production`, `android`, `load-test` para evitar concurrencia destructiva.                                             |

---

## 9. Cutover y rollback

### Secuencia

1. **Congelación de merges** un viernes: solo hotfixes, y por cherry-pick a ambas ramas.
2. **Espejo final** GitHub→GitLab (push de `main`, `develop` y tags) y verificación de que cada SHA
   coincide (`git rev-parse` en ambos remotes).
3. **Activación de MRs** en GitLab: se abre un MR de prueba contra `develop` y se comprueba que el
   pipeline bloquea el merge sin verde y que los revisores asignados reciben notificación.
4. **Doble push durante 2 semanas**: GitLab es la fuente de verdad; cada merge se empuja también a
   GitHub (`git push github develop main`), con Actions **observado** pero no bloqueante.
5. **Desactivación de Actions**: renombrar `.github/workflows/*.yml` a `*.yml.disabled` en un PR de
   `chore/disable-github-actions`, no borrarlos (histórico y comparación).
6. **Rotación de secretos**: nuevas claves SSH por entorno, `SONAR_TOKEN` regenerado, revocación de
   tokens de GitHub y de las claves de deploy anteriores.
7. **Cierre**: se retira el doble push, se archiva el repo de GitHub como espejo de solo lectura y se
   actualizan `CONTRIBUTING.md` y los enlaces de los runbooks.

### Criterios para revertir a GitHub Actions

- Un job de GitLab produce resultados divergentes de forma reproducible (no un fallo puntual de red).
- Un deploy falla dos veces seguidas por causas de la plataforma (no del código ni del host).
- Pérdida de cobertura de secretos (por ejemplo, un secreto protegido no llega a un deploy válido) sin
  solución en < 1 día.

Reversión: reactivar los workflows (`git mv *.yml.disabled *.yml`), apuntar de nuevo el remoto
principal a GitHub y rotar las claves SSH a las anteriores. El doble push garantiza que GitLab no
tiene commits que GitHub desconozca, por lo que la vuelta es un `git push --force-with-lease` de
`develop`/`main` verificado.

---

## 10. Riesgos y mitigaciones

| Riesgo                                                     | Impacto | Mitigación                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rules:changes` no es equivalente a `paths` en GitHub      | Medio   | En MR usa `changes` con `compare_to` de la rama destino; en push a `develop`/`main` añade `if: $CI_COMMIT_BEFORE_SHA == "0000000000000000000000000000000000000000"` para no saltarse jobs en el primer push. Documentado en el propio job. |
| Secretos no disponibles en MRs de forks                    | Medio   | Los jobs que necesitan secretos se saltan en forks (`if: $CI_PROJECT_PATH == "coffeelovers/mybusiness"`); se valida con el pipeline de una MR desde fork.                                                                                  |
| Deriva `develop`/`main` durante el espejo                  | Alto    | Doble push en cada merge, verificación de SHA antes y después de cada ventana y `ff-only` en `main`.                                                                                                                                       |
| Tiempos de Playwright y Android por encima del presupuesto | Medio   | Cache caliente, imagen Playwright versionada, `retry` solo en fallos de infraestructura y runner self-hosted para Android.                                                                                                                 |
| SonarCloud sin Action oficial                              | Bajo    | `sonarsource/sonar-scanner-cli` con los mismos parámetros; se valida en la fase 5 comparando el dashboard con el de GitHub.                                                                                                                |
| Cuota de minutos de GitLab insuficiente                    | Medio   | Medir minutos del primer mes; mover Android y load-test a runner propio; `interruptible` para cancelar pipelines obsoletos.                                                                                                                |
| Cache de GitLab no compartida entre runners                | Bajo    | Cache de pnpm por lockfile y capas Docker en registry (`type=registry`), no en el runner.                                                                                                                                                  |
| Pérdida de SARIF/code scanning al salir de GitHub          | Bajo    | `artifacts:reports:sast` en GitLab + artefacto `.sarif` descargable; revisión manual semanal.                                                                                                                                              |

---

## 11. Checklist de migración

**Fase 0 — decisiones**

- [ ] ADR de CI/CD en GitLab aprobado (plataforma, runners, registry, secretos).
- [ ] Inventario de secretos de GitHub exportado y contrastado con §6.
- [ ] Decidido el destino de issues/MRs históricos (migrar o no).

**Fase 1 — esqueleto**

- [ ] Proyecto importado con historial completo y `develop` como rama por defecto.
- [ ] `develop` protegida (no force-push, merge con pipeline verde).
- [ ] `main` protegida y ff-only.
- [ ] `.gitlab-ci.yml` con stages y `.node` base commiteado.
- [ ] Pipeline verde en un MR de prueba (solo `backend:lint`).

**Fase 2 — backend**

- [ ] `backend:lint` y `backend:format` equivalentes a `ci.yml`.
- [ ] `backend:typecheck` con `needs` de lint/format.
- [ ] `backend:test` publicando cobertura y JUnit.
- [ ] `backend:contracts` con artifact de drift al fallar.
- [ ] `backend:build` dependiente de typecheck/test/contracts.
- [ ] `backend:e2e` con los 4 servicios por alias y espera activa de salud.
- [ ] URLs de BD/Redis apuntando a hostnames de servicio, no a `127.0.0.1`.

**Fase 3 — web**

- [ ] `web:quality` con contraste, typecheck, cobertura y build.
- [ ] `web:contracts` con las mismas rutas de `rules:changes`.
- [ ] `web:e2e` con Chromium instalado y `junit.xml` como reporte.
- [ ] `web:a11y` ejecutando `accessibility.spec.ts`.
- [ ] Diffs visuales (`*-diff.png`) descargables al fallar.
- [ ] Cache de Next.js validada (segunda ejecución más rápida).

**Fase 4 — Android**

- [ ] Runner/imagen con JDK 17 y SDK 35 publicada y etiquetada `heavy`.
- [ ] Cache de Gradle caliente (segundo build < 15 min).
- [ ] `android:build` con unit tests + `assembleDebug` y APK como artifact.
- [ ] `timeout` y `resource_group` configurados.

**Fase 5 — seguridad**

- [ ] `security:trivy-fs` en SARIF como artifact.
- [ ] `web:trivy-image` bloqueante en CRITICAL/HIGH con `ignore-unfixed`.
- [ ] `sonar-scanner` con `SONAR_TOKEN` protegido y quality gate aplicado.
- [ ] SAST/Dependency/Container Scanning nativos activados.
- [ ] Resultados comparados con los de GitHub (mismo número de hallazgos o justificado).

**Fase 6 — CD**

- [ ] `package:web` publica en `$CI_REGISTRY_IMAGE` con tags `sha` y rama.
- [ ] `deploy:staging` automático en `develop` con `environment` y smoke.
- [ ] `deploy:production` manual con aprobación en `main`.
- [ ] Rollback al tag anterior probado en staging (fallo forzado).

**Fase 7 — automatizaciones**

- [ ] Schedule nocturno de E2E ejecutado con éxito.
- [ ] Schedule semanal de load test (FULL) ejecutado.
- [ ] `renovate.json` activo y primer MR generado.
- [ ] Merge trains y auto-merge configurados en `develop`.
- [ ] Job de release por tag y notificaciones Slack/Telegram verificados.

**Fase 8 — cutover**

- [ ] Congelación de merges comunicada.
- [ ] Espejo final verificado por SHA en `main`, `develop` y tags.
- [ ] Actions desactivadas (`*.yml.disabled`) y PR mergeado.
- [ ] Secretos rotados y los antiguos revocados.
- [ ] Dos semanas de doble push sin incidencias.
- [ ] `README.md` de migración actualizado con el estado final y `CONTRIBUTING.md` apuntando a GitLab.

---

## 12. Esfuerzo estimado

| Fase                    | Días persona |
| ----------------------- | ------------ |
| 0 — Decisiones y ADR    | 0.5          |
| 1 — Espejo y esqueleto  | 1.0          |
| 2 — Paridad backend     | 2.0          |
| 3 — Paridad web         | 1.5          |
| 4 — Android             | 1.5          |
| 5 — Seguridad y calidad | 1.0          |
| 6 — CD                  | 2.0          |
| 7 — Automatizaciones    | 1.0          |
| 8 — Cutover y runbook   | 1.0          |
| **Total**               | **11.5**     |

Lectura: **8–12 días persona** de trabajo efectivo, más **2 semanas de calendario en paralelo** para
el doble push y la validación de paridad. El rango bajo (8 días) asume runner Android ya disponible y
SonarCloud reutilizado; el alto (12) incluye imprevistos de cache, red de runners y ajustes de
`rules:changes`.

---

## 13. Anexo: `.gitlab-ci.yml` de referencia

Estructura propuesta: un archivo raíz con `stages`, `workflow`, `default` e `include` de cinco
archivos en `.gitlab/ci/`. Es coherente con el repo: pnpm 12.9.1 (corepack), Node 20, Playwright,
Gradle con JDK 17, Docker BuildKit y Postgres 16 / Redis 7.

### 13.1 `.gitlab-ci.yml`

```yaml
stages:
  - validate
  - test
  - build
  - security
  - e2e
  - package
  - deploy
  - release

include:
  - local: .gitlab/ci/base.yml
  - local: .gitlab/ci/backend.yml
  - local: .gitlab/ci/web.yml
  - local: .gitlab/ci/android.yml
  - local: .gitlab/ci/security.yml
  - local: .gitlab/ci/deploy.yml

default:
  interruptible: true
  retry:
    max: 1
    when:
      - runner_system_failure
      - stuck_or_timeout_failure

variables:
  NODE_IMAGE: node:20-bookworm-slim
  PNPM_VERSION: '12.9.1'
  PNPM_STORE_DIR: $CI_PROJECT_DIR/.pnpm-store
  NEXT_TELEMETRY_DISABLED: '1'
  CI: 'true'
  DOCKER_DRIVER: overlay2
  GIT_DEPTH: '20'

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == 'develop'
    - if: $CI_COMMIT_BRANCH == 'main'
    - if: $CI_COMMIT_TAG
    - if: $CI_PIPELINE_SOURCE == 'schedule'
    - if: $CI_PIPELINE_SOURCE == 'web'
```

### 13.2 `.gitlab/ci/base.yml`

```yaml
.node:
  image: $NODE_IMAGE
  before_script:
    - corepack enable
    - corepack prepare "pnpm@${PNPM_VERSION}" --activate
    - pnpm config set store-dir "$PNPM_STORE_DIR"
    - pnpm install --frozen-lockfile
  cache: &pnpm_cache
    key:
      files:
        - pnpm-lock.yaml
    paths:
      - .pnpm-store
    policy: pull-push

.node-cached:
  extends: .node
  cache:
    <<: *pnpm_cache
    policy: pull

.wait-services:
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends postgresql-client redis-tools
    - for i in $(seq 1 30); do pg_isready -h postgres -U finance_user -d finance_db && break; sleep 2; done
    - for i in $(seq 1 30); do pg_isready -h postgres-agent -U agent_user -d agent_db && break; sleep 2; done
    - for i in $(seq 1 30); do pg_isready -h postgres-audit -U audit_user -d audit_db && break; sleep 2; done
    - for i in $(seq 1 30); do redis-cli -h redis -a test_password --no-auth-warning ping && break; sleep 2; done

.rules:default:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == 'develop'
    - if: $CI_COMMIT_BRANCH == 'main'
```

### 13.3 `.gitlab/ci/backend.yml`

```yaml
backend:lint:
  extends: [.node, .rules:default]
  stage: validate
  script:
    - pnpm lint

backend:format:
  extends: [.node, .rules:default]
  stage: validate
  script:
    - pnpm format:check

backend:typecheck:
  extends: [.node-cached, .rules:default]
  stage: validate
  needs: [backend:lint, backend:format]
  script:
    - pnpm typecheck

backend:test:
  extends: [.node-cached, .rules:default]
  stage: test
  needs: [backend:lint, backend:format]
  script:
    - pnpm test:cov
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - coverage/lcov.info
      - '**/junit.xml'
    reports:
      junit: '**/junit.xml'

backend:contracts:
  extends: [.node-cached, .rules:default]
  stage: test
  needs: [backend:lint, backend:format]
  script:
    - pnpm --filter @mybusiness/contracts build
    - pnpm --filter @mybusiness/common build
    - pnpm --filter @mybusiness/api-gateway build
    - pnpm contracts:check
    - pnpm contracts:check:kotlin
  artifacts:
    when: on_failure
    expire_in: 7 days
    paths:
      - docs/openapi/api-gateway.json
      - node_modules/.cache/contracts-check/
      - contracts-drift.diff

backend:build:
  extends: [.node-cached, .rules:default]
  stage: build
  needs: [backend:typecheck, backend:test, backend:contracts]
  script:
    - pnpm build
  artifacts:
    expire_in: 1 day
    paths:
      - apps/*/dist
      - packages/*/dist

backend:e2e:
  extends: [.node-cached, .wait-services, .rules:default]
  stage: e2e
  needs: [backend:build]
  timeout: 20m
  services:
    - name: postgres:16-alpine
      alias: postgres
      variables:
        POSTGRES_USER: finance_user
        POSTGRES_PASSWORD: test_password
        POSTGRES_DB: finance_db
    - name: pgvector/pgvector:pg16
      alias: postgres-agent
      variables:
        POSTGRES_USER: agent_user
        POSTGRES_PASSWORD: test_password
        POSTGRES_DB: agent_db
    - name: postgres:16-alpine
      alias: postgres-audit
      variables:
        POSTGRES_USER: audit_user
        POSTGRES_PASSWORD: test_password
        POSTGRES_DB: audit_db
    - name: redis:7-alpine
      alias: redis
      command: ['redis-server', '--requirepass', 'test_password']
  variables:
    REDIS_HOST: redis
    REDIS_PORT: '6379'
    REDIS_PASSWORD: test_password
    FINANCE_DATABASE_URL: postgresql://finance_user:test_password@postgres:5432/finance_db
    AGENT_DATABASE_URL: postgresql://agent_user:test_password@postgres-agent:5432/agent_db
    AUDIT_DATABASE_URL: postgresql://audit_user:test_password@postgres-audit:5432/audit_db
  script:
    - pnpm build
    - pnpm --filter @mybusiness/finance-service db:migrate
    - psql "$AGENT_DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
    - pnpm --filter @mybusiness/agent-service db:migrate
    - pnpm --filter @mybusiness/audit-service db:migrate
    - pnpm test:e2e
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - '**/junit.xml'
    reports:
      junit: '**/junit.xml'
```

### 13.4 `.gitlab/ci/web.yml`

```yaml
.web-rules:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
      changes:
        - apps/web/**/*
        - apps/api-gateway/**/*
        - packages/contracts/**/*
        - packages/common/**/*
        - docs/openapi/**/*
        - docs/design/**/*
        - scripts/**/*
        - pnpm-lock.yaml
        - pnpm-workspace.yaml
        - .gitlab/ci/web.yml
    - if: $CI_COMMIT_BRANCH == 'develop'
      changes:
        - apps/web/**/*
        - packages/contracts/**/*
        - packages/common/**/*
        - pnpm-lock.yaml
        - .gitlab/ci/web.yml
    - if: $CI_COMMIT_BRANCH == 'main'
      changes:
        - apps/web/**/*
        - packages/contracts/**/*
        - packages/common/**/*
        - pnpm-lock.yaml
        - .gitlab/ci/web.yml

web:quality:
  extends: [.node, .web-rules]
  stage: validate
  timeout: 10m
  cache:
    - <<: *pnpm_cache
    - key:
        files:
          - pnpm-lock.yaml
      paths:
        - apps/web/.next/cache
  script:
    - pnpm --filter @mybusiness/web lint
    - pnpm exec prettier --check "apps/web/**/*.{ts,tsx,css,json,md}"
    - pnpm test:contrast
    - pnpm --filter @mybusiness/web typecheck
    - pnpm --filter @mybusiness/web test:cov
    - pnpm --filter @mybusiness/web build
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - apps/web/coverage/lcov.info

web:contracts:
  extends: [.node-cached, .web-rules]
  stage: test
  timeout: 10m
  script:
    - pnpm --filter @mybusiness/contracts build
    - pnpm --filter @mybusiness/common build
    - pnpm --filter @mybusiness/api-gateway build
    - pnpm contracts:check
    - pnpm contracts:check:kotlin
  artifacts:
    when: on_failure
    expire_in: 7 days
    paths:
      - docs/openapi/api-gateway.json
      - contracts-drift.diff

web:e2e:
  extends: [.node, .web-rules]
  stage: e2e
  needs: [web:quality, web:contracts]
  timeout: 15m
  script:
    - pnpm --filter @mybusiness/web exec playwright install --with-deps chromium
    - pnpm --filter @mybusiness/web test
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - apps/web/playwright-report
      - apps/web/test-results
      - '**/*-diff.png'
      - '**/*-actual.png'
    reports:
      junit: apps/web/test-results/junit.xml

web:a11y:
  extends: [.node, .web-rules]
  stage: e2e
  needs: [web:quality]
  timeout: 15m
  script:
    - pnpm --filter @mybusiness/web exec playwright install --with-deps chromium
    - pnpm --filter @mybusiness/web exec playwright test e2e/accessibility.spec.ts
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - apps/web/playwright-report
      - apps/web/test-results
```

### 13.5 `.gitlab/ci/android.yml`

```yaml
android:build:
  stage: build
  image: $ANDROID_IMAGE
  tags: [heavy]
  resource_group: android
  interruptible: false
  timeout: 30m
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
      changes: [apps/mobile-android/**/*, .gitlab/ci/android.yml]
    - if: $CI_COMMIT_BRANCH == 'develop'
      changes: [apps/mobile-android/**/*, .gitlab/ci/android.yml]
    - if: $CI_COMMIT_BRANCH == 'main'
      changes: [apps/mobile-android/**/*, .gitlab/ci/android.yml]
  cache:
    key:
      files:
        - apps/mobile-android/gradle/wrapper/gradle-wrapper.properties
        - apps/mobile-android/app/build.gradle.kts
    paths:
      - .gradle/caches
      - .gradle/wrapper
  variables:
    GRADLE_USER_HOME: $CI_PROJECT_DIR/.gradle
    ANDROID_HOME: /opt/android-sdk
  before_script:
    - cd apps/mobile-android
    - chmod +x gradlew
  script:
    - ./gradlew :core:designsystem:testDebugUnitTest :core:common:testDebugUnitTest
      :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace --console=plain
  artifacts:
    when: always
    expire_in: 14 days
    paths:
      - apps/mobile-android/app/build/outputs/apk/debug/*.apk
      - apps/mobile-android/**/build/reports/tests
      - apps/mobile-android/**/build/reports/lint-results*.html
    reports:
      junit:
        - apps/mobile-android/**/build/test-results/testDebugUnitTest/*.xml
```

### 13.6 `.gitlab/ci/security.yml`

```yaml
.security-rules:
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == 'develop'
    - if: $CI_COMMIT_BRANCH == 'main'
    - if: $CI_PIPELINE_SOURCE == 'schedule' && $SECURITY_AUDIT == '1'

security:trivy-fs:
  extends: .security-rules
  stage: security
  image:
    name: aquasec/trivy:latest
    entrypoint: ['']
  script:
    - trivy fs --format sarif --output trivy-fs.sarif --severity CRITICAL,HIGH
      --ignore-unfixed --scanners vuln,secret .
  artifacts:
    when: always
    expire_in: 7 days
    paths: [trivy-fs.sarif]
    reports:
      sast: trivy-fs.sarif

web:trivy-image:
  stage: security
  image: docker:27
  services: [docker:27-dind]
  variables:
    DOCKER_TLS_CERTDIR: '/certs'
  needs: [web:quality]
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
      changes: [apps/web/**/*, apps/web/Dockerfile]
    - if: $CI_COMMIT_BRANCH == 'develop'
      changes: [apps/web/**/*, apps/web/Dockerfile]
  script:
    - docker build -f apps/web/Dockerfile -t mybusiness-web:$CI_COMMIT_SHORT_SHA .
    - docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
      -v "$PWD:/work" aquasec/trivy:latest image
      --severity CRITICAL,HIGH --ignore-unfixed --scanners vuln,secret
      --format sarif --output /work/trivy-web.sarif mybusiness-web:$CI_COMMIT_SHORT_SHA
    - docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
      -v "$PWD:/work" aquasec/trivy:latest image
      --severity CRITICAL,HIGH --ignore-unfixed --scanners vuln,secret
      --exit-code 1 mybusiness-web:$CI_COMMIT_SHORT_SHA
  artifacts:
    when: always
    expire_in: 7 days
    paths: [trivy-web.sarif]

backend:sonar:
  extends: .node-cached
  stage: security
  image: sonarsource/sonar-scanner-cli:latest
  needs: [backend:test]
  rules:
    - if: $SONAR_TOKEN == null
      when: never
    - if: $CI_COMMIT_BRANCH == 'develop'
    - if: $CI_COMMIT_BRANCH == 'main'
  script:
    - sonar-scanner -Dsonar.projectKey=CoffeLovers_mybusiness
      -Dsonar.organization=coffeelovers -Dsonar.sources=apps,packages
      -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
      -Dsonar.exclusions=**/.next/**,**/coverage/**,**/dist/**,apps/web/lib/generated/**
  allow_failure: true

web:sonar:
  stage: security
  image: sonarsource/sonar-scanner-cli:latest
  needs: [web:quality]
  rules:
    - if: $SONAR_TOKEN == null
      when: never
    - if: $CI_COMMIT_BRANCH == 'develop'
      changes: [apps/web/**/*]
  script:
    - sonar-scanner -Dsonar.projectKey=CoffeLovers_mybusiness
      -Dsonar.organization=coffeelovers -Dsonar.sources=apps/web
      -Dsonar.javascript.lcov.reportPaths=apps/web/coverage/lcov.info
      -Dsonar.exclusions=apps/web/.next/**,apps/web/coverage/**,
      apps/web/playwright-report/**,apps/web/lib/generated/**
  allow_failure: true

include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Dependency-Scanning.gitlab-ci.yml
  - template: Security/Container-Scanning.gitlab-ci.yml
```

### 13.7 `.gitlab/ci/deploy.yml`

```yaml
package:web:
  stage: package
  image: docker:27
  services: [docker:27-dind]
  variables:
    DOCKER_TLS_CERTDIR: '/certs'
  rules:
    - if: $CI_COMMIT_BRANCH == 'develop'
      changes:
        [
          apps/web/**/*,
          packages/contracts/**/*,
          packages/common/**/*,
          pnpm-lock.yaml,
          apps/web/Dockerfile,
        ]
    - if: $CI_COMMIT_BRANCH == 'main'
      changes:
        [
          apps/web/**/*,
          packages/contracts/**/*,
          packages/common/**/*,
          pnpm-lock.yaml,
          apps/web/Dockerfile,
        ]
  script:
    - echo "$CI_JOB_TOKEN" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker buildx create --use --driver docker-container
    - >-
      docker buildx build --file apps/web/Dockerfile --platform linux/amd64
      --cache-from "type=registry,ref=$CI_REGISTRY_IMAGE:cache"
      --cache-to "type=registry,ref=$CI_REGISTRY_IMAGE:cache,mode=max"
      --tag "$CI_REGISTRY_IMAGE/web:$CI_COMMIT_SHA"
      --tag "$CI_REGISTRY_IMAGE/web:$CI_COMMIT_REF_SLUG"
      --push .
  artifacts:
    expire_in: 1 day
    paths: [image-digest.txt]

.deploy-base:
  stage: deploy
  image: alpine:3.20
  needs: [package:web]
  interruptible: false
  before_script:
    - apk add --no-cache openssh-client curl
    - eval "$(ssh-agent -s)"
    - chmod 600 "$SSH_KEY_FILE"
    - ssh-add "$SSH_KEY_FILE"
  script:
    - |
      IMAGE="$CI_REGISTRY_IMAGE/web:$CI_COMMIT_SHA"
      CONTAINER="${CONTAINER_NAME}"
      PORT="${HOST_PORT}"
      ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" \
        IMAGE="$IMAGE" CONTAINER="$CONTAINER" PORT="$PORT" \
        CI_REGISTRY="$CI_REGISTRY" CI_REGISTRY_USER="$CI_REGISTRY_USER" CI_JOB_TOKEN="$CI_JOB_TOKEN" \
        'bash -s' <<'REMOTE'
      set -euo pipefail
      echo "$CI_JOB_TOKEN" | docker login "$CI_REGISTRY" -u "$CI_REGISTRY_USER" --password-stdin
      docker pull "$IMAGE"
      if docker inspect "$CONTAINER" >/dev/null 2>&1; then
        docker inspect --format '{{.Config.Image}}' "$CONTAINER" > /tmp/previous-image
      else
        rm -f /tmp/previous-image
      fi
      docker rm -f "$CONTAINER" || true
      docker run -d --name "$CONTAINER" --restart unless-stopped \
        -p "${PORT}:3000" -e NODE_ENV=production "$IMAGE"
      sleep 30
      if ! curl -fsS "http://127.0.0.1:${PORT}/healthz"; then
        echo "Smoke FAILED"
        if [ -s /tmp/previous-image ]; then
          docker rm -f "$CONTAINER" || true
          docker run -d --name "$CONTAINER" --restart unless-stopped \
            -p "${PORT}:3000" -e NODE_ENV=production "$(cat /tmp/previous-image)" || true
        fi
        exit 1
      fi
      REMOTE
  artifacts:
    when: always
    expire_in: 7 days
    paths: [deploy.log]

deploy:staging:
  extends: .deploy-base
  resource_group: deploy/staging
  environment:
    name: staging
    url: $STAGING_URL
  rules:
    - if: $CI_COMMIT_BRANCH == 'develop'
  variables:
    DEPLOY_HOST: $STAGING_HOST
    DEPLOY_USER: $STAGING_USER
    SSH_KEY_FILE: $STAGING_SSH_KEY
    CONTAINER_NAME: mybusiness-web
    HOST_PORT: '3000'
  after_script:
    - curl -fsS "$STAGING_URL/healthz" || exit 1
    - test "$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/login")" = '200'

deploy:production:
  extends: .deploy-base
  resource_group: deploy/production
  when: manual
  environment:
    name: production
    url: $PRODUCTION_URL
  rules:
    - if: $CI_COMMIT_BRANCH == 'main'
  variables:
    DEPLOY_HOST: $PRODUCTION_HOST
    DEPLOY_USER: $PRODUCTION_USER
    SSH_KEY_FILE: $PRODUCTION_SSH_KEY
    CONTAINER_NAME: mybusiness-web-prod
    HOST_PORT: '3001'
  after_script:
    - curl -fsS "$PRODUCTION_URL/healthz" || exit 1
    - test "$(curl -s -o /dev/null -w '%{http_code}' "$PRODUCTION_URL/login")" = '200'

release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script:
    - echo "Publicando release $CI_COMMIT_TAG"
  release:
    tag_name: $CI_COMMIT_TAG
    description: 'Release $CI_COMMIT_TAG generado por GitLab CI'

notify:
  stage: .post
  image: alpine:3.20
  rules:
    - if: $CI_COMMIT_BRANCH == 'develop'
    - if: $CI_COMMIT_BRANCH == 'main'
  when: always
  before_script:
    - apk add --no-cache curl
  script:
    - |
      if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        curl -fsS -X POST -H 'Content-Type: application/json' \
          -d "{\"text\":\"Pipeline $CI_PIPELINE_STATUS · $CI_PROJECT_PATH · $CI_COMMIT_REF_NAME · $CI_PIPELINE_URL\"}" \
          "$SLACK_WEBHOOK_URL"
      fi
```

> Los jobs `deploy:*` heredan `needs: [package:web]`; en `main` el pipeline solo ejecuta `package:web`
> si cambian rutas web, por lo que un release sin cambios de web debe lanzar el deploy manualmente
> (`when: manual` sobre el pipeline) o vía `$FORCE_DEPLOY=1`.

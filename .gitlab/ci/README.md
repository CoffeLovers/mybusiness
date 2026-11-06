# CI/CD de GitLab — guía operativa

Pipeline primario del monorepo. El equivalente de GitHub Actions vive en
`.github/workflows/` y se mantiene **solo como referencia/espejo** hasta el cutover
(ver [`docs/migration/gitlab-ci-cd/RUNBOOK.md`](../../docs/migration/gitlab-ci-cd/RUNBOOK.md)).

## 1. Estructura

| Archivo                   | Contenido                                                                                                |
| :------------------------ | :------------------------------------------------------------------------------------------------------- |
| `.gitlab-ci.yml`          | `stages`, `include`, `default` y la plantilla `.pnpm-base` (corepack + store de pnpm).                   |
| `.gitlab/ci/backend.yml`  | `backend:lint`, `format`, `typecheck`, `test`, `contracts`, `build`, `e2e`.                              |
| `.gitlab/ci/web.yml`      | `web:quality`, `web:e2e`, `web:a11y`, `web:visual`, `web:security`, `web:sonar`.                         |
| `.gitlab/ci/android.yml`  | `android:build` (JDK 17 + SDK 35, cache de Gradle).                                                      |
| `.gitlab/ci/security.yml` | `security:trivy`, `security:audit`, `security:sonar` (opt-in).                                           |
| `.gitlab/ci/deploy.yml`   | `web:image`, `web:deploy:staging` (automático en `develop`), `web:deploy:production` (manual en `main`). |
| `.gitlab/ci/load.yml`     | `load:ingest-50k` (k6, manual, runner `load`).                                                           |
| `renovate.json`           | Renovate: patches con automerge, majors etiquetados, alertas de vulnerabilidad.                          |

### Stages

`validate → test → build → security → deploy`

- **validate**: lint, formato, typecheck y contratos. Es el gate barato y rápido.
- **test**: unitarios, e2e backend, Playwright (e2e, a11y, visual) y carga k6.
- **build**: compilación del monorepo y publicación de la imagen web en el registry.
- **security**: Trivy, `pnpm audit` y SonarCloud.
- **deploy**: despliegue SSH a staging/producción (solo `develop`/`main`).

## 2. Reglas (`rules`)

- Los jobs de calidad corren en **MRs y en pipelines de push**.
- `backend:test`, `backend:build`, `web:*` usan `rules:changes` para no ejecutarse en cambios
  que no les afectan.
- Los jobs de despliegue **nunca** corren en una rama de trabajo: exigen `develop` (staging) o
  `main` (producción) y cambios en `apps/web/**` o artefactos asociados.
- `security:sonar` y `load:ingest-50k` son opt-in (`SONAR_TOKEN`, `RUN_LOAD_TEST`).
- Ningún job imprime secretos: los scripts de deploy usan `set +x` y el env-file remoto se escribe
  con `umask 077`.

## 3. Variables

### Configuración del pipeline

| Variable         | Dónde            | Uso                                                          |
| :--------------- | :--------------- | :----------------------------------------------------------- |
| `RUN_LOAD_TEST`  | Schedule         | `"true"` habilita `load:ingest-50k` (queda manual).          |
| `SONAR_TOKEN`    | CI/CD vars       | Habilita `web:sonar` / `security:sonar`; masked y protegida. |
| `PNPM_STORE_DIR` | `.gitlab-ci.yml` | Store de pnpm cacheado entre jobs.                           |

### Despliegue

| Grupo      | Variables                                                                                     |
| :--------- | :-------------------------------------------------------------------------------------------- |
| Staging    | `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY` (File), `STAGING_URL`, `WEB_*`.             |
| Producción | `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY` (File), `PRODUCTION_URL`, `WEB_*`. |
| Registry   | `REGISTRY_DEPLOY_USER`, `REGISTRY_DEPLOY_PASSWORD` (deploy token `read_registry`).            |

`WEB_*`: `WEB_SESSION_SECRET`, `WEB_GATEWAY_URL`, `WEB_ALLOWED_ORIGINS`, `WEB_SECURE_COOKIES`.

### Carga (`load:ingest-50k`)

Masked, **no** protegidas (los schedules corren en `develop`): `POSTGRES_PASSWORD`,
`AUTH_DB_PASSWORD`, `FINANCE_DB_PASSWORD`, `AGENT_DB_PASSWORD`, `AUDIT_DB_PASSWORD`,
`REDIS_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`, `BANK_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`.

El job genera un `.env` efímero con `umask 077` a partir de estas variables; no se versiona ni
se imprime. Son credenciales de prueba: no reutilizar las de staging/producción.

## 4. Runners

| Runner      | Tags        | Requisitos                                                                                                                           |
| :---------- | :---------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Shared**  | _(sin tag)_ | Linux + Docker executor. Suficiente para lint, typecheck, tests, Playwright, Trivy y Sonar.                                          |
| **Android** | `android`   | Imagen con JDK 17, Android SDK 35, `build-tools;35.0.0`; ≥ 4 vCPU / 8 GB / 60 GB; cache de Gradle.                                   |
| **Load**    | `load`      | ≥ 4 vCPU / **≥ 4 GB RAM** / ≥ 40 GB; `/var/run/docker.sock` **montado** (Compose in-place, no dind); idealmente dedicado y nocturno. |

`load:ingest-50k` usa `docker:27-cli` como imagen del job (necesita Docker Compose, Node y
pnpm) y ejecuta los escenarios dentro de la imagen oficial `grafana/k6:latest` con
`docker run --network host`. La imagen de k6 corre como uid 12345 y no puede instalar paquetes,
por eso no se usa directamente como imagen del job. Si el runner no expone el socket de Docker,
el job falla en el primer paso con un mensaje explícito.

> **Estado actual:** el runner con tag `load` aún no está registrado. Por eso el job es manual y
> `allow_failure: true`: los schedules no se quedan bloqueados esperándolo.

## 5. Schedules

Los schedules se crean por API (no en YAML) porque son configuración del proyecto:

```bash
glab api projects/:id/pipeline_schedules \
  --method POST \
  -f description="E2E nocturno" \
  -f ref=develop \
  -f cron="0 3 * * *"

glab api projects/:id/pipeline_schedules \
  --method POST \
  -f description="Carga 50k semanal (manual)" \
  -f ref=develop \
  -f cron="0 4 * * 0" \
  -f "variables[][key]=RUN_LOAD_TEST" \
  -f "variables[][value]=true"
```

| Schedule      | Cron        | Ref       | Efecto                                                            |
| :------------ | :---------- | :-------- | :---------------------------------------------------------------- |
| `nightly-e2e` | `0 3 * * *` | `develop` | Pipeline completo (test, e2e web/backend, contratos, seguridad).  |
| `weekly-load` | `0 4 * * 0` | `develop` | Pipeline con `RUN_LOAD_TEST=true` → `load:ingest-50k` **manual**. |

Lanzar uno a mano: **CI/CD → Schedules → ▶ Run**. Un schedule también se puede disparar por API:

```bash
glab api projects/:id/pipeline_schedules/:schedule_id/play --method POST
```

> **Limitación conocida (GitLab.com, token actual):** el `POST/PUT` de schedules no persiste
> `variables` y el endpoint `/pipeline_schedules/:id/variables` responde `403 Forbidden`
> ("The current user is not authorized to set pipeline schedule variables"). `weekly-load` se creó
> sin la variable: el pipeline semanal corre, pero sin `load:ingest-50k`. Para completarlo, añadir
> la variable desde **CI/CD → Schedules → weekly-load → Edit → Variables**
> (`RUN_LOAD_TEST=true`) o repetir el `POST` con un PAT con scope `api` y rol Maintainer/Owner.
> Con la variable puesta, el job aparece **manual** y solo hay que pulsar ▶.

### ¿Por qué el load test es manual?

- Necesita **75 minutos** y un runner con Docker socket y ≥ 4 GB: no debe competir con MRs.
- El escenario FULL inserta 50.000 transacciones reales en PostgreSQL; ejecutarlo en cada push
  ensuciaría los entornos y agotaría la cuota de minutos.
- Mientras no exista el runner `load`, el schedule semanal debe seguir creando el pipeline sin
  dejar un job en `pending` eternamente: `when: manual` + `allow_failure` lo aíslan.
- La ejecución se pide explícitamente (`RUN_LOAD_TEST=true` + play), y sus artefactos
  (`tests/load/k6-summary.json`, `tests/load/verification-54.json`) son la evidencia de la issue #54.

## 6. Renovate

`renovate.json` agrupa dependencias npm como `pnpm dependencies`, automergea solo **patches**
(`automergeType: mr`, sujeto a pipeline verde) y deja los **majors** con etiquetas
`dependencies` + `major` para revisión. Ventana: lunes antes de las 06:00 (America/Bogota).
Las alertas de vulnerabilidad se etiquetan como `security`.

## 7. Referencias

- ADR de plataforma: [`docs/adr/009-gitlab-ci-cd-platform.md`](../../docs/adr/009-gitlab-ci-cd-platform.md)
- Runbook de cutover y rollback: [`docs/migration/gitlab-ci-cd/RUNBOOK.md`](../../docs/migration/gitlab-ci-cd/RUNBOOK.md)
- Pruebas de carga: [`tests/load/README.md`](../../tests/load/README.md)

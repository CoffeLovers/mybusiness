# ADR 009: Plataforma de CI/CD — GitLab CI/CD, runners y registry

## Estado

Propuesto (se acepta formalmente en el cutover, MIG-08 #141)

## Fecha

2026-11-05

## Contexto

La CI/CD del monorepo `mybusiness` vive hoy en seis workflows de GitHub Actions (`ci.yml`, `web-ci.yml`,
`security.yml`, `android.yml`, `load-test.yml`, `web-cd.yml`). El plan de migración
(`docs/migration/gitlab-ci-cd/README.md`) exige paridad funcional: todo job bloqueante en GitHub debe
tener un equivalente bloqueante en GitLab, con los mismos gates (lint, formato, tipos, tests,
contratos, build, E2E, a11y, seguridad, Sonar) y los mismos entornos (`staging`, `production`).

MIG-01 (#134) necesita cerrar tres decisiones antes de que el resto de issues (MIG-02 … MIG-07)
escriba jobs: **plataforma**, **runners** y **registry**. Sin ellas, cada issue tomaría criterios
distintos sobre imágenes, capacidad y autenticación.

Restricciones reales del repositorio:

- Monorepo pnpm 12.9.1 con `--frozen-lockfile`; Node 20 en CI.
- `tsc --build` del monorepo es intensivo en RAM; los E2E levantan 4 servicios + Redis.
- Hay una app Android (JDK 17 + Android SDK 35) que necesita toolchain completo.
- Los deploys son SSH + Docker a hosts existentes; no cambia el proveedor de cloud.
- SonarCloud se mantiene (no se migra a SonarQube self-managed).
- La salida de GitHub Actions está bloqueada por facturación de la cuenta, lo que refuerza la
  necesidad de una plataforma con runners propios o incluidos sin coste por minuto.

## Decisión

1. **Plataforma: GitLab.com (SaaS)**, proyecto `CoffeLovers/mybusiness`, con `develop` como rama por
   defecto y `main` como espejo protegido que solo avanza por fast-forward. Se descarta GitLab
   self-managed en esta fase: exigiría operar la instancia, backups y actualizaciones sin aportar
   nada que el SaaS no cubra.
2. **Runners**:
   - **Shared runners** de GitLab.com para `backend:lint`, `format`, `typecheck`, `contracts`,
     `backend:build` y `web:quality` (2 vCPU / 4 GB bastan).
   - **Shared runners de mayor tamaño** (4 vCPU / 8 GB) para `backend:test`, `backend:e2e`, `web:e2e`,
     `web:a11y` y `load:ingest-50k`.
   - **Runner propio con Docker executor** para `android:build`: imagen con `eclipse-temurin:17-jdk`,
     `cmdline-tools`, `platforms;android-35`, `build-tools;35.0.0` y `platform-tools`, con caché de
     Gradle en `GRADLE_USER_HOME=$CI_PROJECT_DIR/.gradle`.
   - **Runner propio** para `load:ingest-50k` si el job supera el presupuesto de 75 min en shared
     (necesita Docker-in-Docker o socket, 4 vCPU / 8 GB / 80 GB).
3. **Registry: GitLab Container Registry** (`$CI_REGISTRY_IMAGE`), sustituyendo GHCR. Autenticación
   con `CI_JOB_TOKEN` (sin gestión manual de credenciales) y BuildKit con caché en registry.
4. **Secretos**: se mantiene `SONAR_TOKEN` y los cuatro secretos de deploy sin rotar durante el
   espejo (la rotación es parte de MIG-08). `GITHUB_TOKEN`, `GITHUB_ACTOR` y las credenciales de GHCR
   desaparecen. Los secretos de staging y producción viven en _environments_ separados y son
   `protected`: un MR de fork no recibe ninguno. Tabla completa de nombre, tipo, protección y entorno
   en `docs/migration/gitlab-ci-cd/README.md` §6.
5. **Pipeline mínimo de arranque**: un `.gitlab-ci.yml` con un solo stage `validate` y el job
   `backend:lint`, suficiente para demostrar en un MR de prueba que el proyecto importado ejecuta
   pipelines y que el merge queda bloqueado si el pipeline falla. El resto de stages se añade en
   MIG-02 … MIG-07.

## Alternativas descartadas

1. **GitLab self-managed**: control total, pero se paga en operación (instancia, backups, upgrades,
   runners) sin necesidad actual; el coste supera el beneficio para un monorepo de este tamaño.
2. **Mantener GitHub Actions con runners self-hosted**: resuelve el bloqueo de facturación, pero deja
   fuera merge trains, environments con aprobación y registry integrado, y no era el objetivo de la
   migración.
3. **Todos los jobs en runners propios desde el día 1**: elimina el límite de minutos pero duplica el
   mantenimiento de imágenes y capacidad antes de conocer el consumo real de cada job.
4. **Registry externo (Docker Hub / GHCR)**: añade credenciales manuales por job y un punto de fallo
   más; el registry de GitLab se autentica con el token efímero del job.

## Consecuencias

- Positivas: gates equivalentes con menos YAML, entornos con aprobación nativa, registry autenticado
  por job, merge trains y schedules sin servicios externos, y desbloqueo del CI (que hoy no arranca
  por facturación de GitHub).
- Negativas: se depende de la disponibilidad de GitLab.com; el job Android y el de carga exigen
  runners propios (coste y mantenimiento); durante el espejo conviven dos plataformas y hay doble
  push.
- Riesgo asumido: el bloqueo de facturación de GitHub Actions impide validar hoy los jobs originales
  en verde; la paridad se comprobará job a job en MIG-02 … MIG-05 contra las definiciones de
  `.github/workflows/`.

## Referencias

- Plan de migración: `docs/migration/gitlab-ci-cd/README.md` (§6 secretos, §7 runners).
- Issues de la migración: `docs/migration/gitlab-ci-cd/ISSUES.md` · epic #142.
- ADR 002 (transporte Redis) y ADR 005 (rate-limiting) no se ven afectados: la migración no cambia
  el stack de ejecución, solo la plataforma de CI/CD.

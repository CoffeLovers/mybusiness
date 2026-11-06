# Runbook — Cutover de CI/CD a GitLab (MIG-08 · #141)

Procedimiento operativo para dejar **GitLab como plataforma primaria** de CI/CD y de revisión de
código, con GitHub como espejo de solo lectura, y para revertir con seguridad si algo falla.

- **Owner:** DevOps (`@Umbrex47`)
- **Depende de:** MIG-01 … MIG-07 (pipelines backend, web, Android, seguridad, CD y automatizaciones).
- **Ventana:** 1 día para el corte + **2 semanas** de doble push antes de archivar GitHub.
- **Alcance:** pipelines, deploys, secretos, PRs/MRs y espejo del repositorio. **No** cubre la
  migración de issues históricas ni las alertas de observabilidad.

---

## 1. Estado actual

| Elemento                       | Plataforma primaria | Estado                                                                                   |
| :----------------------------- | :------------------ | :--------------------------------------------------------------------------------------- |
| CI (lint, tipos, tests)        | **GitLab**          | Pipeline `develop` verde (19 jobs) con paridad respecto a `.github/workflows/ci.yml`.    |
| CI web (Playwright, a11y)      | **GitLab**          | Verde; baselines visuales regenerados con la imagen Playwright de CI.                    |
| Android                        | **GitLab**          | `android:build` con SDK 35 + cache de Gradle.                                            |
| Seguridad                      | **GitLab**          | Trivy + `pnpm audit` bloqueantes; Sonar opt-in por `SONAR_TOKEN`.                        |
| CD                             | **GitLab**          | `web:image` → registry; staging automático en `develop`, producción manual en `main`.    |
| Deploy staging                 | **GitLab**          | **Real y verificado** (`/healthz` OK).                                                   |
| Automatizaciones               | **GitLab**          | Schedules `nightly-e2e` y `weekly-load`, `renovate.json`, job de carga manual.           |
| Revisión de código (PR/MR)     | **GitHub**          | Sigue siendo el flujo activo: PRs contra `develop` con `gh pr create`.                   |
| GitHub Actions                 | **GitHub**          | **Deshabilitado** por facturación; el repo y los workflows se conservan como referencia. |
| Repositorio (fuente de verdad) | **GitHub**          | Hasta el corte: GitLab recibe pushes, GitHub tiene los PRs y el historial canónico.      |

**Conclusión:** el gate real de calidad y el despliegue ya son de GitLab; lo que falta es mover la
revisión (PRs → MRs), congelar el flujo de merges y archivar GitHub.

---

## 2. Corte (cutover)

Ejecutar en este orden, en una ventana de baja actividad (viernes por la tarde).

### 2.1 Congelación de merges

1. Anunciar en el canal del equipo: "congelación de merges hasta nuevo aviso; solo hotfixes".
2. Deshabilitar merges en GitHub: **Settings → Branches → `develop` → Require pull request** ya
   impide pushes directos; añadir además un aviso en el README del repo durante la ventana.
3. Los hotfixes de la ventana entran **por cherry-pick a `develop` y `main`** y se documentan en el
   issue de seguimiento.

### 2.2 Espejo final

```bash
git fetch origin --prune
git fetch gitlab --prune
# Tags y ramas de release
git push gitlab --tags
# Ramas de trabajo (todas menos HEAD); main/develop van por MR (ver §2.3)
./scripts/mirror-to-gitlab.sh
```

Verificación SHA a SHA (debe imprimir las mismas tuplas):

```bash
for ref in main develop; do
  echo "$ref github=$(git rev-parse "origin/$ref") gitlab=$(git rev-parse "gitlab/$ref")"
done
git ls-remote --tags origin | sort -k2 > /tmp/gh-tags.txt
git ls-remote --tags gitlab | sort -k2 > /tmp/gl-tags.txt
diff /tmp/gh-tags.txt /tmp/gl-tags.txt && echo "tags idénticos"
```

### 2.3 `main` y `develop` por MR

`main` y `develop` están protegidas en GitLab (sin force-push, sin borrado, merge solo con pipeline
verde). El script empuja una rama temporal para que el cambio entre por MR:

1. El script crea y empuja `sync/develop-<timestamp>` (y `sync/main-<timestamp>` si `main` diverge).
2. Abrir MR de `sync/*` contra `develop` (y de `develop` contra `main`, fast-forward).
3. Verificar que el pipeline del MR queda verde y mergear desde la UI.

> Si GitLab ya está al día, el script no crea ramas temporales.

### 2.4 Verificar pipelines

- Pipeline de `develop` en GitLab: **verde** y con los 19 jobs esperados.
- Pipeline de `main`: verde (o al menos `validate`/`test`/`build`, sin deploys automáticos).
- `web:deploy:staging` ejecutado y `/healthz` respondiendo (§5).
- Revisar que no queden jobs en `pending` por runners ausentes (Android/load).

### 2.5 Conmutar PRs a MRs

1. Comunicar: "desde ahora los cambios se abren como **MR contra `develop` en GitLab**".
2. Cerrar PRs abiertas en GitHub: cada una se reabre como MR en GitLab (mismo branch ya espejado)
   con enlace al PR original.
3. Actualizar `.github/PULL_REQUEST_TEMPLATE.md` y `CONTRIBUTING.md` (ya apunta a GitLab en la
   sección "CI/CD (GitLab)").
4. Activar **merge trains** en `develop` y `merge_when_pipeline_succeeds` para MRs de Renovate/docs.

### 2.6 Rotar secretos

Rotar **después** del corte y antes de archivar GitHub (ver §4).

### 2.7 Archivar GitHub

Solo tras 2 semanas de doble push sin incidencias:

1. Retirar el doble push del flujo diario.
2. Renombrar los workflows a `*.yml.disabled` en un PR `chore/disable-github-actions` (no borrarlos).
3. **Settings → Danger Zone → Archive this repository**.
4. Actualizar `README.md` y este runbook con la fecha y el SHA final espejado.

---

## 3. Rollback

GitHub Actions queda **deshabilitado pero el repositorio intacto durante 2 semanas**. La vuelta es
posible en cualquier momento de la ventana.

### 3.1 Mecánica

- **Doble push** durante la ventana: cada merge en GitLab se empuja a GitHub
  (`git push origin develop main`), de modo que GitHub nunca se queda atrás y contiene exactamente
  los mismos commits.
- **Actions deshabilitado**: los workflows existen (o como `*.yml.disabled`), pero no consumen
  minutos ni bloquean nada.

### 3.2 Criterios para revertir

Revertir a GitHub Actions si ocurre **cualquiera** de estos, de forma reproducible:

1. Un job de GitLab da resultados divergentes de forma sistemática (no un fallo puntual de red).
2. Un deploy falla **dos veces seguidas** por causas de la plataforma (no del código ni del host).
3. Un secreto protegido no llega a un deploy válido y no hay solución en menos de 1 día.
4. Los runners shared están caídos > 4 h y no hay alternativa self-hosted operativa.
5. Los schedules no se ejecutan durante 2 noches consecutivas por límites del plan.

### 3.3 Procedimiento de reversión

```bash
# 1. Reactivar workflows
git mv .github/workflows/*.yml.disabled .github/workflows/  # si se habían renombrado
git commit -m "chore(ci): reactivar GitHub Actions (rollback de cutover)" && git push origin develop

# 2. Comprobar que GitHub tiene el estado de GitLab (el doble push lo garantiza)
git fetch origin && git fetch gitlab
git rev-parse origin/develop gitlab/develop

# 3. Si hay divergencia, forzar con lease (solo tras verificar el diff)
git push origin "gitlab/develop:develop" --force-with-lease

# 4. Restaurar secretos anteriores en GitHub y revocar los rotados en el paso 2.6
```

- La vuelta **no requiere** reescribir historial si el doble push se mantuvo: `develop`/`main`
  deberían ser idénticos.
- Tras revertir, abrir un incidente con causa raíz y **no** reintentar el cutover hasta corregirla.

---

## 4. Rotación de secretos

Rotar **todas** las credenciales que tocaron ambas plataformas. Orden: generar → cargar en GitLab
(protegidas/masked) → validar deploy → revocar las antiguas en GitHub y proveedores.

| Secreto                                  | Emisor                                         | Dónde vive en GitLab                                         | Revocación                                        |
| :--------------------------------------- | :--------------------------------------------- | :----------------------------------------------------------- | :------------------------------------------------ |
| `SONAR_TOKEN`                            | SonarCloud                                     | CI/CD variable **masked + protected**                        | Revocar token antiguo en SonarCloud → My Account  |
| `STAGING_HOST`, `STAGING_USER`           | Host staging                                   | Variables de entorno `staging`                               | —                                                 |
| `STAGING_SSH_KEY`                        | `ssh-keygen` nuevo                             | Variable tipo **File**, protegida, `staging`                 | Borrar clave pública antigua de `authorized_keys` |
| `STAGING_URL`                            | Host staging                                   | `staging`                                                    | —                                                 |
| `PRODUCTION_HOST`, `PRODUCTION_USER`     | Host producción                                | `production`, **protegidas**                                 | —                                                 |
| `PRODUCTION_SSH_KEY`                     | `ssh-keygen` nuevo                             | **File**, protegida, `production`                            | Borrar clave pública antigua                      |
| `PRODUCTION_URL`                         | Host producción                                | `production`                                                 | —                                                 |
| `WEB_SESSION_SECRET`                     | `openssl rand -hex 32`                         | `staging` y `production`                                     | Rotar también en el host (env-file)               |
| `WEB_GATEWAY_URL`, `WEB_ALLOWED_ORIGINS` | Config                                         | `staging` / `production`                                     | —                                                 |
| `WEB_SECURE_COOKIES`                     | Config (`true` en prod)                        | `production`                                                 | —                                                 |
| Deploy token del registry                | GitLab → Settings → Repository → Deploy tokens | `REGISTRY_DEPLOY_USER` / `REGISTRY_DEPLOY_PASSWORD` (masked) | Revocar token antiguo en la misma pantalla        |
| Tokens de GitHub (PAT, deploy keys)      | GitHub                                         | —                                                            | Revocar todos tras archivar el repo               |

Reglas:

- Nunca escribir secretos en YAML, `.env` versionado ni logs. Los jobs usan `set +x`.
- `masked` exige ≥ 8 caracteres sin saltos de línea; si un valor no cumple, guardarlo como **File**.
- Los secretos de producción van **protected**: solo los jobs de `main` los ven.
- Tras rotar, lanzar `web:deploy:staging` y un `web:deploy:production` manual para validar.

---

## 5. Verificación post-cutover

Checklist técnico (todo debe pasar antes de declarar el cutover cerrado):

| #   | Verificación                                                        | Comando / evidencia                                        |
| :-- | :------------------------------------------------------------------ | :--------------------------------------------------------- |
| 1   | Pipeline `develop` verde con los 19 jobs                            | GitLab → CI/CD → Pipelines                                 |
| 2   | Pipeline `main` verde (sin deploys automáticos)                     | GitLab → CI/CD → Pipelines                                 |
| 3   | `web:deploy:staging` ejecutado tras un merge real                   | Job log + environment `staging`                            |
| 4   | `/healthz` responde 200 en staging                                  | `curl -fsS "$STAGING_URL/healthz"`                         |
| 5   | `/login` carga y el formulario autentica                            | Navegador + `curl -I "$STAGING_URL/login"`                 |
| 6   | Contratos sin drift (OpenAPI + Kotlin)                              | `backend:contracts`, `web:contracts` verdes                |
| 7   | Android compila y publica APK                                       | `android:build` + artifact `app-debug.apk`                 |
| 8   | Trivy y `pnpm audit` sin HIGH/CRITICAL nuevos                       | `security:trivy`, `security:audit`                         |
| 9   | Sonar con `SONAR_TOKEN` nuevo                                       | `web:sonar` / `security:sonar`                             |
| 10  | MR de prueba bloqueado con pipeline rojo y mergeable con verde      | MR `test/cutover-gate`                                     |
| 11  | Merge train funciona con dos MRs verdes consecutivos                | 2 MRs mergeados en serie                                   |
| 12  | Schedules `nightly-e2e` y `weekly-load` visibles y ejecutados       | CI/CD → Schedules → historial                              |
| 13  | `load:ingest-50k` manual (o pendiente documentado si no hay runner) | Job + artifacts `k6-summary.json` / `verification-54.json` |
| 14  | Renovate abrió al menos un MR etiquetado contra `develop`           | Dependency Dashboard                                       |
| 15  | Secretos rotados y antiguos revocados                               | §4 completado                                              |
| 16  | SHA de `main`/`develop` idénticos en ambos remotos                  | `git rev-parse origin/<ref> gitlab/<ref>`                  |
| 17  | Tags idénticos en ambos remotos                                     | `git ls-remote --tags` diff                                |
| 18  | Doble push funcionando (2 semanas)                                  | Historial de commits en ambos remotos                      |
| 19  | `CONTRIBUTING.md` y README apuntan a GitLab                         | Revisión de docs                                           |
| 20  | GitHub archivado con workflows en `*.yml.disabled`                  | GitHub → Settings → Archive                                |

---

## 6. Checklist de 20 puntos (resumen ejecutable)

**Antes del corte**

- [ ] 1. Pipeline `develop` verde con paridad de jobs respecto a GitHub Actions.
- [ ] 2. Deploy staging real verificado (`/healthz` + login).
- [ ] 3. Variables y secretos inventariados y cargados en GitLab (masked/protected/File).
- [ ] 4. Runners disponibles: shared, Android (`android`) y load (`load`, documentado si falta).
- [ ] 5. Schedules `nightly-e2e` y `weekly-load` creados y probados.
- [ ] 6. `renovate.json` activo y primer MR revisado.
- [ ] 7. ADR de plataforma (`docs/adr/009-gitlab-ci-cd-platform.md`) aprobado.

**Corte**

- [ ] 8. Congelación de merges anunciada.
- [ ] 9. Espejo final de `main`, `develop`, ramas y tags (`scripts/mirror-to-gitlab.sh`).
- [ ] 10. SHA y tags idénticos en ambos remotos.
- [ ] 11. MRs de sincronización (`sync/*`) mergeados con pipeline verde.
- [ ] 12. PRs abiertas cerradas y reabiertas como MRs en GitLab.
- [ ] 13. Merge trains y `merge_when_pipeline_succeeds` activados en `develop`.
- [ ] 14. Doble push configurado (GitLab → GitHub tras cada merge).

**Post-corte**

- [ ] 15. Secretos rotados y antiguos revocados (§4).
- [ ] 16. Verificación post-cutover §5 completa (pipeline, staging, `/healthz`, login, contratos, Android).
- [ ] 17. `CONTRIBUTING.md` y README actualizados con GitLab como primario.
- [ ] 18. Dos semanas de doble push sin incidencias.
- [ ] 19. GitHub Actions deshabilitado (`*.yml.disabled`) y repo archivado.
- [ ] 20. Incidente de cutover cerrado con lecciones aprendidas en `docs/migration/gitlab-ci-cd/`.

---

## 7. Contactos y enlaces

- Pipeline: <https://gitlab.com/coffelovers2/mybusiness/-/pipelines>
- Schedules: <https://gitlab.com/coffelovers2/mybusiness/-/pipeline_schedules>
- Registry: <https://gitlab.com/coffelovers2/mybusiness/container_registry>
- Guía operativa de CI/CD: [`../../.gitlab/ci/README.md`](../../.gitlab/ci/README.md)
- Pruebas de carga: [`../../tests/load/README.md`](../../tests/load/README.md)

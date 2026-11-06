# Contribuir

Guía normativa para trabajar en este repositorio. Cualquier desviación debe justificarse en la PR.

## Ramas

- `develop` es la **rama de integración**: todo el trabajo aterriza aquí.
- `main` es **espejo de release** y solo avanza por **fast-forward desde `develop`**. Nunca se commitea directo en `main` ni se hacen merges con cambios propios.
- Ramas de trabajo, creadas desde `develop` y con nombre descriptivo:
  - `feat/<tema>-#<issue>` (ej. `feat/checkout-3ds-#128`)
  - `fix/<tema>-#<issue>` (ej. `fix/redis-timeout-#145`)
  - `docs/<tema>`
  - `chore/<tema>`

## Pull Requests

- Toda PR se abre **contra `develop`**:

  ```bash
  gh pr create --base develop
  ```

- Una PR abierta contra `main` se **cierra y se reabre contra `develop`**. No se mergea a `main` desde una PR.
- La PR debe referenciar la issue (`Closes #<issue>`) y describir el alcance, el riesgo y cómo se validó.

## CI/CD (GitLab)

- **El pipeline de GitLab es el gate real.** Un cambio solo está listo cuando su pipeline en
  <https://gitlab.com/coffelovers2/mybusiness/-/pipelines> está verde (lint, tipos, tests,
  contratos, seguridad y build).
- **GitHub Actions está deshabilitado por facturación.** No esperes checks de Actions: si la PR
  de GitHub aparece sin checks, es lo esperado; la evidencia es el job de GitLab.
- **Empuja la rama a ambos remotos** para que exista el MR en GitLab y el espejo en GitHub:

  ```bash
  git push origin <rama>
  git push gitlab <rama>
  # o, tras configurar los push URLs:
  git push --all origin
  ```

- **Los merges a `develop` y `main` en GitLab van por MR.** Ambas ramas están protegidas: no se
  admite push directo ni force-push. Abre el MR contra `develop`, adjunta la URL del pipeline verde
  y mergea desde la UI (merge train / `merge_when_pipeline_succeeds`).
- `main` solo avanza por **fast-forward desde `develop`**; los tags de release se crean en GitLab.
- Guía operativa (stages, runners, variables y schedules): [`.gitlab/ci/README.md`](.gitlab/ci/README.md).
- Procedimiento de cutover, espejo y rollback: [`docs/migration/gitlab-ci-cd/RUNBOOK.md`](docs/migration/gitlab-ci-cd/RUNBOOK.md).

## Commits

Formato **Conventional Commits**:

```text
feat|fix|docs|test|refactor|chore(scope): mensaje en imperativo, minúsculas, sin punto final
```

- Referencia la issue cuando aplique (`... (#128)` o `Refs: #128`).
- Commits atómicos: un cambio lógico por commit.

## Hooks y calidad

- **Husky + lint-staged son obligatorios.** Está **prohibido** usar `--no-verify` (ni `git commit`, ni `git push`).
- Antes de pedir revisión, ejecuta y deja en verde:

  ```bash
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test
  pnpm build
  ```

- Validaciones adicionales según el área tocada:
  - Web: `pnpm --filter @mybusiness/web test`
  - Android: `./gradlew :app:testDebugUnitTest :app:assembleDebug`

## Criterios de merge

- CI completamente verde (lint, tipos, tests, SonarQube, Trivy).
- Definition of Done de la issue cumplida.
- Sin secretos, credenciales ni claves en código, logs o fixtures.
- Sin nuevos `any` (ni casts que los eludan).
- Cobertura: **≥ 80 % en backend**, **≥ 90 % statements / 85 % branches en web**.
- Si hay UI, checklist de [`docs/design/DESIGN-RULES.md`](docs/design/DESIGN-RULES.md) revisado.

## Versionado de `main`

`main` se sincroniza **solo** tras verificar que `develop` está estable y verde:

```bash
git push origin develop:main
```

- Si el push es rechazado, **no forzar**: investiga la divergencia y resuélvela en `develop`.
- `--force` está prohibido salvo incidente documentado y aprobado.

## Referencias

- [`docs/PLAN-INTEGRAL-DESARROLLO.md`](docs/PLAN-INTEGRAL-DESARROLLO.md) — plan de desarrollo.
- [`docs/sprints/*/ISSUES.md`](docs/sprints) — issues por sprint.
- [`docs/adr/`](docs/adr) — decisiones de arquitectura.

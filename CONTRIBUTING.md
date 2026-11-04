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

# Runbook — despliegue del portal web

> Pipeline: `.github/workflows/web-ci.yml` (CI) y `.github/workflows/web-cd.yml` (CD). Issue SF2-02.

## Arquitectura del pipeline

| Etapa      | Workflow     | Disparador                                                | Resultado                                                                               |
| ---------- | ------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CI         | `web-ci.yml` | PR/push con cambios en `apps/web`, `packages/*`, lockfile | lint, format, typecheck, tests con cobertura, build, E2E Playwright, Trivy y SonarCloud |
| Build      | `web-cd.yml` | push a `develop` o `main`                                 | imagen `ghcr.io/<owner>/mybusiness-web:<sha>`                                           |
| Staging    | `web-cd.yml` | push a `develop`                                          | despliegue automático + smoke                                                           |
| Producción | `web-cd.yml` | push a `main`                                             | despliegue con aprobación manual del environment `production`                           |

## Prerrequisitos de configuración (una sola vez)

- **Secrets** del repositorio/organización: `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`, `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `SONAR_TOKEN`.
- **Variables**: `STAGING_URL`, `PRODUCTION_URL`.
- **Environments**: `staging` (sin revisor) y `production` con _required reviewers_ y _prevent self-review_ si el equipo lo permite.
- **Branch protection** en `develop` y `main`: exigir los checks `quality`, `e2e`, `security` y `sonar` de `Web CI`, además de los checks del backend. **Limitación actual:** el repositorio es privado en el plan gratuito de GitHub y la API de protección de ramas responde 403; hasta que se cambie de plan (o el repo sea público) los checks se aplican por convención y revisión, no por bloqueo técnico.
- **Paquetes**: la acción usa `GITHUB_TOKEN`; si el paquete se publica en una org, marca el paquete como público o concede acceso de lectura al servidor.

Si faltan los secretos de un entorno, el job de despliegue **se omite** (no falla) y el workflow publica un `notice`.

## Despliegue normal

1. El merge a `develop` dispara `web-cd`.
2. `build` publica la imagen con tag inmutable `<sha>` y cache de GitHub Actions.
3. `deploy-staging` ejecuta: pull de la imagen, guarda la imagen en ejecución en `/tmp/mybusiness-web-previous`, recrea el contenedor `mybusiness-web` y verifica `GET /healthz` durante 30 s.
4. Smoke externo: `GET {STAGING_URL}/healthz` y `GET {STAGING_URL}/login` (200).
5. Producción: mismo flujo con aprobación manual del environment `production` y el contenedor `mybusiness-web-prod` en el puerto 3001.

## Rollback

El rollback es automático en el paso de despliegue: si el smoke interno falla y existe `/tmp/mybusiness-web-previous`, el script vuelve a arrancar la imagen anterior y termina con código 1 (el job queda rojo y visible).

Rollback manual:

```bash
ssh "$STAGING_HOST"
sudo docker inspect --format '{{.Config.Image}}' mybusiness-web
sudo docker rm -f mybusiness-web
sudo docker run -d --name mybusiness-web --restart unless-stopped \
  -p 3000:3000 -e NODE_ENV=production ghcr.io/<owner>/mybusiness-web:<sha-anterior>
curl -fsS http://127.0.0.1:3000/healthz
```

Para promocionar una imagen concreta sin reconstruir, vuelve a lanzar `web-cd` desde el commit deseado (`gh workflow run web-cd.yml --ref <rama>`).

## Diagnóstico

| Síntoma                | Causa probable                                                       | Acción                                                       |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `web-ci` bloquea el PR | lint/tipos/tests/build o umbral de cobertura (90 % líneas en `lib/`) | ejecuta el comando local equivalente                         |
| `security` falla       | vulnerabilidad CRITICAL/HIGH con fix disponible                      | actualiza la dependencia base o justifica el riesgo en el PR |
| `sonar` omitido        | falta `SONAR_TOKEN`                                                  | configura el secreto; el job no bloquea hasta entonces       |
| Smoke 502              | contenedor no arrancó o puerto ocupado                               | `docker logs mybusiness-web`                                 |
| Rollback no ocurrió    | no existía contenedor previo (primer despliegue)                     | relanza el workflow del SHA estable                          |

## Límites conocidos

- Un solo host por entorno y sin orquestador: el despliegue reinicia el contenedor (unos segundos de indisponibilidad).
- No hay migraciones de base de datos en el portal (no consume BD directamente; habla con el gateway).
- El smoke de `/login` sólo valida el código HTTP, no el contenido.

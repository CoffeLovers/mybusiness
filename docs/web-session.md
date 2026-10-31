# Sesión web BFF — `apps/web`

> Implementado en la issue SF2-03. El navegador nunca recibe tokens de acceso ni de refresco.

## Modelo

El portal es un BFF: los Route Handlers de `/api/session/*` hablan con el API Gateway y guardan la sesión en una cookie **sellada** (`mb_session`, `HttpOnly`, `Secure` en producción, `SameSite=Lax`, `Path=/`).

| Elemento     | Contenido                                                                                                      | Legible por JS               |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `mb_session` | AES-256-GCM: usuario, `tenantId`, rol, access/refresh token, `sessionId`, `deviceId`, `issuedAt`, `lastSeenAt` | No                           |
| `mb_csrf`    | Token double-submit `nonce.hmac` ligado al `sessionId`                                                         | Sí (no es secreto de sesión) |

## Endpoints

| Ruta                   | Método | Protección         | Descripción                                                  |
| ---------------------- | ------ | ------------------ | ------------------------------------------------------------ |
| `/api/session/login`   | POST   | `Origin` permitido | Autentica contra el gateway y crea la sesión                 |
| `/api/session/refresh` | POST   | `Origin` + CSRF    | Rota el refresh token en el gateway                          |
| `/api/session/logout`  | POST   | `Origin` + CSRF    | Revoca el dispositivo; `?all=true` revoca todas las sesiones |
| `/api/session/me`      | GET    | Sesión             | Devuelve el usuario público y renueva la cookie deslizante   |
| `/api/session/csrf`    | GET    | Sesión             | Regenera el token CSRF                                       |

## Invariantes

1. **Sin tokens en el cliente.** Las respuestas sólo incluyen `user` y `expiresAt`; `localStorage`/`sessionStorage` no se usan nunca.
2. **CSRF double-submit.** Toda mutación exige `x-csrf-token` igual a la cookie `mb_csrf` y validado con HMAC ligado al `sessionId`.
3. **Origin obligatorio.** Los POST sin `Origin`/`Referer` permitido devuelven 403 `origin_not_allowed`.
4. **Expiraciones.** Inactividad 30 min (`lastSeenAt`) y límite absoluto 12 h (`issuedAt`); el refresh no reinicia el límite absoluto.
5. **Rotación real.** Cada refresh sustituye el refresh token; reutilizar uno revocado invalida la familia en `auth-service` y el BFF limpia cookies.
6. **Reautenticación.** Las operaciones sensibles (hoy el cierre global) exigen sesión con actividad < 5 min; si no, `403 reauth_required`.
7. **Revocación global.** `POST /api/session/logout?all=true` llama a `auth.logout_all` en `auth-service` y revoca todas las familias del usuario.

## Variables de entorno

`WEB_SESSION_SECRET` (obligatoria, ≥ 32 caracteres), `WEB_GATEWAY_URL`, `WEB_ALLOWED_ORIGINS`, `WEB_SECURE_COOKIES`.

## Pruebas

```bash
pnpm --filter @mybusiness/web test:unit   # cripto, política, CSRF, guardas
pnpm --filter @mybusiness/web test        # E2E con un gateway simulado (e2e/mock-gateway.mjs)
```

Los E2E cubren login, credenciales inválidas, CSRF, origen no permitido, refresh y logout. La expiración por inactividad y absoluta se prueba de forma determinista en `test/session.spec.ts`.

## Límites conocidos

- La sesión es stateless: el BFF no mantiene una lista de sesiones activas; la revocación efectiva vive en `auth-service`.
- Un usuario puede tener varias sesiones (una por dispositivo); `logout?all=true` las revoca todas.
- Sin detección de robo de dispositivo (`deviceId` es informativo).

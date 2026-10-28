# Runbook: Configuración de `TRUST_PROXY_HOPS` en despliegues multi-salto

## Contexto

El API Gateway (Express) resuelve `req.ip` a partir de la cabecera `X-Forwarded-For`.
En despliegues detrás de balanceadores/reverse proxies, Express debe conocer cuántos saltos
confiables existen para evitar que un cliente spoofee `X-Forwarded-For` y evada el rate-limiting
por IP (política `auth` en rutas públicas).

La configuración se establece en `apps/api-gateway/src/setup.ts`:

```ts
httpAdapter.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
```

## Variable de entorno

| Variable           | Default | Descripción                                                          |
| ------------------ | ------- | -------------------------------------------------------------------- |
| `TRUST_PROXY_HOPS` | `1`     | Número de saltos (proxies) confiables entre el cliente y el gateway. |

## Guía de valores según topología

| Topología                                     | Valor recomendado | Notas                                |
| --------------------------------------------- | ----------------- | ------------------------------------ |
| Desarrollo local (sin proxy)                  | `1` (default)     | Express confía en el socket directo. |
| 1 balanceador (nginx/ALB) delante del gateway | `1`               | El proxy añade 1 salto.              |
| CDN + balanceador (2 saltos)                  | `2`               | Cloudflare/CloudFront + ALB/nginx.   |
| CDN + WAF + balanceador (3 saltos)            | `3`               | Ajustar según cadena real.           |

## Riesgos

- **Valor demasiado alto:** un atacante puede spoofear `X-Forwarded-For` y evadir rate-limiting por IP.
- **Valor demasiado bajo:** `req.ip` resuelve a la IP del proxy, colapsando todos los clientes en una sola cuota (falsos 429).

## Verificación

Tras cambiar `TRUST_PROXY_HOPS`, ejecutar la suite E2E de seguridad:

```bash
pnpm --filter @mybusiness/api-gateway test:e2e
```

El test "anti-bypass" rota `X-Forwarded-For` spoofed desde la misma IP y espera 429 tras 5 intentos.

## Referencias

- ADR-005: `docs/adr/005-rate-limiting-fail-mode.md`
- `apps/api-gateway/src/setup.ts`

/**
 * Resolución del destino de vuelta tras el widget de Plaid.
 *
 * El lanzador (`/banking/link`) recibe el destino en `redirect_uri`. Sólo se
 * permiten rutas internas de bancos y el deep link nativo de Android; cualquier
 * otro valor cae al destino por defecto para evitar redirecciones abiertas.
 */

/** Destino por defecto cuando `redirect_uri` falta o no está permitido. */
export const DEFAULT_REDIRECT = '/bancos';

/** Destino nativo que la app Android usa al volver del widget. */
export const DEEP_LINK_REDIRECT = 'mybusiness://banking/return';

/**
 * Allowlist de destinos de vuelta.
 *
 * - El deep link `mybusiness://banking/return` se devuelve **literalmente**: es
 *   un destino nativo validado, no un open redirect. En la app navega con
 *   `window.location.assign('mybusiness://...')`, que el `intent-filter` de
 *   `MainActivity` (scheme `mybusiness`, host `banking`, pathPrefix `/return`)
 *   intercepta y entrega el `public_token` a Kotlin.
 * - Sólo se aceptan rutas internas que empiecen por `/bancos` y que no sean
 *   protocol-relative (`//host` abre un redirección abierta).
 * - Las URLs absolutas (`https://…`) y cualquier otro valor caen al destino
 *   por defecto.
 */
export function resolveReturnTo(rawRedirect: string | undefined): string {
  if (rawRedirect === undefined) {
    return DEFAULT_REDIRECT;
  }

  if (rawRedirect === DEEP_LINK_REDIRECT) {
    return rawRedirect;
  }

  if (rawRedirect.startsWith('/bancos') && !rawRedirect.startsWith('//')) {
    return rawRedirect;
  }

  return DEFAULT_REDIRECT;
}

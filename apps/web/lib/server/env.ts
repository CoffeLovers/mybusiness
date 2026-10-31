/**
 * Lectura validada de variables de entorno del servidor.
 *
 * Sin valores por defecto para el secreto de sesión: un fallback inseguro
 * sería peor que un arranque fallido.
 */

const MIN_SECRET_LENGTH = 32;
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:3000';
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:3001';

export interface ServerEnv {
  sessionSecret: string;
  gatewayUrl: string;
  allowedOrigins: string[];
  secureCookies: boolean;
}

/** Elimina las barras finales de una URL base. */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Divide una lista separada por comas, recortando y descartando vacíos. */
function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Construye la configuración del servidor a partir de `process.env`.
 *
 * @throws Error si `WEB_SESSION_SECRET` falta o no alcanza 32 caracteres.
 */
export function getServerEnv(): ServerEnv {
  const sessionSecret = process.env['WEB_SESSION_SECRET'];

  if (sessionSecret === undefined || sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `WEB_SESSION_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres y estar definida`,
    );
  }

  const rawGatewayUrl = process.env['WEB_GATEWAY_URL']?.trim();
  const gatewayUrl = stripTrailingSlashes(
    rawGatewayUrl !== undefined && rawGatewayUrl.length > 0 ? rawGatewayUrl : DEFAULT_GATEWAY_URL,
  );

  const rawOrigins = process.env['WEB_ALLOWED_ORIGINS'];
  const allowedOrigins = parseOrigins(
    rawOrigins !== undefined && rawOrigins.trim().length > 0 ? rawOrigins : DEFAULT_ALLOWED_ORIGINS,
  );

  const secureCookies =
    process.env['NODE_ENV'] === 'production' || process.env['WEB_SECURE_COOKIES'] === 'true';

  return { sessionSecret, gatewayUrl, allowedOrigins, secureCookies };
}

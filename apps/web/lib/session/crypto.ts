/**
 * Cifrado y autenticación de la cookie de sesión.
 *
 * El token que viaja al navegador es un sobre AES-256-GCM: confidencial
 * (el contenido no se puede leer) e íntegro (cualquier manipulación falla la
 * verificación del auth tag). Sin dependencias externas, sólo `node:crypto`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { SessionRecord } from './types';

const TOKEN_PREFIX = 'v1.';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 32;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Garantiza un secreto con entropía mínima. */
export function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error('WEB_SESSION_SECRET debe tener al menos 32 caracteres');
  }
}

/** Deriva la clave AES de 32 bytes a partir del secreto de aplicación. */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Decodifica base64url validando el alfabeto; devuelve `null` si no es válido. */
function decodeBase64Url(value: string): Buffer | null {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');

  // Rechaza cadenas no canónicas (longitud o relleno inconsistentes).
  if (decoded.toString('base64url') !== value) {
    return null;
  }

  return decoded;
}

/** Comprueba la forma mínima que debe tener un `SessionRecord` recuperado. */
function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const user = record['user'];

  if (typeof user !== 'object' || user === null) {
    return false;
  }

  const userRecord = user as Record<string, unknown>;

  return (
    record['version'] === 1 &&
    isNonEmptyString(record['sessionId']) &&
    isNonEmptyString(userRecord['id']) &&
    isNonEmptyString(userRecord['tenantId']) &&
    isNonEmptyString(record['accessToken']) &&
    isNonEmptyString(record['refreshToken'])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Cifra y autentica una sesión.
 *
 * @throws Error si el secreto no alcanza la longitud mínima.
 */
export function sealSession(session: SessionRecord, secret: string): string {
  assertSecret(secret);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX + iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Abre un token de sesión. Devuelve `null` ante cualquier fallo: formato,
 * longitudes, tag de autenticación o contenido inesperado. Nunca lanza.
 */
export function openSession(token: string, secret: string): SessionRecord | null {
  if (secret.length < MIN_SECRET_LENGTH) {
    return null;
  }

  if (!token.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const parts = token.slice(TOKEN_PREFIX.length).split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [ivPart, tagPart, ciphertextPart] = parts;

  if (ivPart === undefined || tagPart === undefined || ciphertextPart === undefined) {
    return null;
  }

  const iv = decodeBase64Url(ivPart);
  const authTag = decodeBase64Url(tagPart);
  const ciphertext = decodeBase64Url(ciphertextPart);

  if (iv === null || authTag === null || ciphertext === null) {
    return null;
  }

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    return null;
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));

    return isSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Firma un nonce con HMAC-SHA256 ligado al identificador de sesión. */
function signCsrf(secret: string, sessionId: string, nonce: string): Buffer {
  return createHmac('sha256', secret).update(`${sessionId}.${nonce}`, 'utf8').digest();
}

/** Genera un token CSRF de doble envío: `nonce.firma`. */
export function generateCsrfToken(secret: string, sessionId: string): string {
  assertSecret(secret);

  const nonce = randomBytes(16).toString('base64url');

  return `${nonce}.${signCsrf(secret, sessionId, nonce).toString('base64url')}`;
}

/**
 * Verifica un token CSRF con comparación en tiempo constante.
 * Devuelve `false` si falta, si el formato es inválido o si no coincide.
 */
export function verifyCsrfToken(
  token: string | undefined,
  secret: string,
  sessionId: string,
): boolean {
  if (token === undefined || token.length === 0) {
    return false;
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    return false;
  }

  const [nonce, signaturePart] = parts;

  if (nonce === undefined || signaturePart === undefined || nonce.length === 0) {
    return false;
  }

  const provided = decodeBase64Url(signaturePart);

  if (provided === null) {
    return false;
  }

  const expected = signCsrf(secret, sessionId, nonce);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

/** Identificador aleatorio de 128 bits en base64url. */
export function generateId(): string {
  return randomBytes(16).toString('base64url');
}

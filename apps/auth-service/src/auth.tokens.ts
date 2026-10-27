import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 48 bytes aleatorios => 256+ bits de entropía codificados en base64url. */
const REFRESH_TOKEN_BYTES = 48;

export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

/** Hash determinista usado para buscar el token sin almacenarlo en claro. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateRefreshToken(
  ttlMs: number,
  familyId: string = randomUUID(),
  now: Date = new Date(),
): GeneratedRefreshToken {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('El TTL del refresh token debe ser un entero positivo.');
  }

  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

  return {
    token,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

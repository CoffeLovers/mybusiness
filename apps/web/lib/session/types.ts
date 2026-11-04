/**
 * Tipos del núcleo de sesión del BFF.
 *
 * La sesión vive únicamente en el servidor: el navegador sólo recibe un token
 * cifrado y autenticado que el BFF abre en cada petición.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
}

export interface SessionRecord {
  version: 1;
  sessionId: string;
  deviceId: string;
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  issuedAt: number;
  lastSeenAt: number;
}

export interface SessionPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}

export type SessionState =
  | { status: 'valid'; session: SessionRecord }
  | { status: 'expired'; reason: 'idle' | 'absolute' }
  | { status: 'invalid' };

export interface SessionCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

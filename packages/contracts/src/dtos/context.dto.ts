import { UserRole } from '../enums';

/**
 * Contexto de ejecución propagado de forma uniforme en todos los RPC entre
 * el API Gateway y los microservicios. Contiene la identidad del tenant,
 * del usuario y su rol RBAC.
 */
export interface RequestContext {
  tenantId: string;
  userId: string;
  role: UserRole;
  channel?: string;
}

/**
 * Alias semántico de `RequestContext` usado en los payloads RPC.
 */
export type RpcContext = RequestContext;

/**
 * Helper de tipo que añade el `tenantId` a un payload existente.
 */
export type WithTenant<T> = T & { tenantId: string };

/**
 * Helper de tipo que añade el contexto completo (tenantId, userId, role)
 * a un payload existente.
 */
export type WithContext<T> = T & RequestContext;

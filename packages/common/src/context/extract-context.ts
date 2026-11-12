import type { RequestContext, RpcContext } from '@mybusiness/contracts';

/**
 * Extrae el contexto multi-tenant (tenantId, userId, role) de un payload RPC.
 *
 * Tolera payloads anidados bajo la propiedad `user` (como en auth.getProfile)
 * y normaliza `id` como alias de `userId`.
 */
export function extractRpcContext(data: unknown): RpcContext {
  const nestedUser =
    data && typeof data === 'object' ? (data as Record<string, unknown>).user : undefined;
  const source = nestedUser && typeof nestedUser === 'object' ? nestedUser : data;

  const record = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;

  const tenantId =
    typeof record.tenantId === 'string' ? record.tenantId : String(record.tenantId ?? '');
  const userId =
    typeof record.userId === 'string'
      ? record.userId
      : typeof record.id === 'string'
        ? record.id
        : String(record.userId ?? record.id ?? '');
  const channel = typeof record.channel === 'string' ? record.channel : undefined;

  return {
    tenantId,
    userId,
    role: record.role as RequestContext['role'],
    ...(channel ? { channel } : {}),
  };
}

/**
 * Elimina del payload las propiedades del contexto RPC, devolviendo el resto.
 */
export function stripRpcContext<T>(data: T): Omit<T, keyof RequestContext> {
  if (!data || typeof data !== 'object') {
    return data as Omit<T, keyof RequestContext>;
  }
  const rest = { ...(data as Record<string, unknown>) };
  delete rest.tenantId;
  delete rest.userId;
  delete rest.role;
  delete rest.channel;
  return rest as Omit<T, keyof RequestContext>;
}

/**
 * @deprecated Usa `extractRpcContext`. Se mantiene como alias de compatibilidad.
 */
export const extractContext = extractRpcContext;

/**
 * @deprecated Usa `stripRpcContext`. Se mantiene como alias de compatibilidad.
 */
export const stripContext = stripRpcContext;

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { extractRpcContext } from '../context/extract-context';

/**
 * Decorador paramétrico para microservicios (transporte RPC). Lee el payload
 * del mensaje y devuelve el contexto multi-tenant (o un campo específico).
 *
 * Uso:
 *   handler(@TenantContext() ctx: RpcContext) { ... }
 *   handler(@TenantContext('tenantId') tenantId: string) { ... }
 */
export const TenantContext = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    let payload: unknown;
    try {
      payload = ctx.switchToRpc().getData();
    } catch {
      const req = ctx.switchToHttp().getRequest();
      payload = req?.user ?? req;
    }
    const context = extractRpcContext(payload);
    if (typeof data === 'string') {
      return (context as unknown as Record<string, unknown>)[data];
    }
    return context;
  },
);

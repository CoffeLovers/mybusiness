import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Devuelve el tenantId del usuario autenticado (extraído del token verificado).
 * No acepta cabeceras del cliente: el contexto de tenant nunca se toma de
 * `x-tenant-id` para evitar spoofing entre tenants.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.tenantId;
  },
);

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector?: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    // El tenant SIEMPRE proviene del token verificado (req.user). Nunca de cabeceras
    // controladas por el cliente, para evitar spoofing entre tenants.
    const tenantId = req?.user?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('Tenant context is missing or invalid');
    }
    return true;
  }
}

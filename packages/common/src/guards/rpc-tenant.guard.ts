import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { extractRpcContext } from '../context/extract-context';

@Injectable()
export class RpcTenantGuard implements CanActivate {
  constructor(private readonly reflector?: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    let payload: unknown;
    try {
      payload = context.switchToRpc().getData();
    } catch {
      const req = context.switchToHttp().getRequest();
      payload = req?.user ?? req;
    }

    const ctx = extractRpcContext(payload);
    if (!ctx.tenantId) {
      throw new UnauthorizedException('Tenant context is missing or invalid');
    }
    return true;
  }
}

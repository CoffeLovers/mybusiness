import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    if (!tenantId) {
      throw new UnauthorizedException('Tenant context is missing or invalid');
    }
    return true;
  }
}

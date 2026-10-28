import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail, ThrottlerRequest } from '@nestjs/throttler';

@Injectable()
export class DistributedThrottlerGuard extends ThrottlerGuard {
  /**
   * Mapeo inteligente y discriminación de políticas por ruta y decorador.
   * Evita que la política restrictiva de 'auth' (5 req/min) bloquee endpoints estándar de 'api' (100 req/min).
   */
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { throttler, context } = requestProps;
    const req = context.switchToHttp().getRequest();
    const url = req?.originalUrl || req?.url || '';

    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/register');
    const isHeavyRoute = url.includes('/agent') || url.includes('/reports');

    // 1. Throttler 'auth': solo aplica a endpoints sensibles de autenticación
    if (throttler.name === 'auth' && !isAuthRoute) {
      return true;
    }

    // 2. Throttler 'heavy': solo aplica a agentes de IA y generación de reportes
    if (throttler.name === 'heavy' && !isHeavyRoute) {
      return true;
    }

    // 3. Throttler 'api': limitador por defecto para endpoints estándar (omite auth y heavy para no duplicar conteo)
    if (throttler.name === 'api' && (isAuthRoute || isHeavyRoute)) {
      return true;
    }

    return super.handleRequest(requestProps);
  }

  /**
   * Resolución de la clave de seguimiento (tracker):
   * - En 'auth': por IP estricta para mitigar ataques de fuerza bruta.
   * - En 'api' y 'heavy': por Tenant / Usuario autenticado, aislando el consumo entre clientes.
   */
  protected async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    const tenantId = req.user?.tenantId || req.headers?.['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    // Si hay contexto de tenant/usuario en la petición, agrupamos por negocio
    if (tenantId) {
      return `tenant:${tenantId}${userId ? `:${userId}` : ''}`;
    }
    if (userId) {
      return `user:${userId}`;
    }

    // Fallback a IP del cliente respetando proxies perimetrales
    const forwarded = req.headers?.['x-forwarded-for'];
    if (forwarded) {
      const clientIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
      if (clientIp) {
        return clientIp;
      }
    }

    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  }

  /**
   * Emisión estricta de cabeceras HTTP RFC (Retry-After, X-RateLimit-*) al alcanzar el umbral 429.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const retryAfterSec = Math.ceil(throttlerLimitDetail.timeToBlockExpire / 1000) || 1;

    this.setResponseHeader(res, 'Retry-After', retryAfterSec);
    this.setResponseHeader(res, 'X-RateLimit-Limit', throttlerLimitDetail.limit);
    this.setResponseHeader(res, 'X-RateLimit-Remaining', 0);
    this.setResponseHeader(res, 'X-RateLimit-Reset', retryAfterSec);

    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}

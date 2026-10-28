import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class DistributedThrottlerGuard extends ThrottlerGuard {
  /**
   * Permite que @SkipThrottle() sin argumentos desactive todas las políticas nombradas (auth, api, heavy).
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();
    const skipDefault = this.reflector.getAllAndOverride<boolean | Record<string, boolean>>(
      'THROTTLER:SKIPdefault',
      [handler, classRef],
    );
    if (skipDefault === true) {
      return true;
    }
    return super.shouldSkip(context);
  }

  /**
   * Resolución de la clave de seguimiento (tracker):
   * - En rutas públicas o de autenticación (login/register): Se usa estrictamente la IP real
   *   resuelta por Express (`req.ip`) a través de 'trust proxy'. NUNCA se confía en cabeceras
   *   arbitrarias como `x-tenant-id` ni `X-Forwarded-For` manipuladas por el cliente.
   * - En rutas autenticadas (políticas 'api' y 'heavy'): Se rastrea por `tenantId` (y `userId`)
   *   extraído exclusivamente del contexto criptográfico de `req.user` verificado por `JwtAuthGuard`.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user;
    if (user && user.tenantId) {
      return `tenant:${user.tenantId}${user.id || user.userId ? `:${user.id || user.userId}` : ''}`;
    }

    // Para rutas sin autenticar o auth público: IP real sin confiar en headers manuales
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  }

  /**
   * Emisión estricta de cabeceras HTTP estándar RFC (Retry-After, X-RateLimit-*) al alcanzar el umbral 429.
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

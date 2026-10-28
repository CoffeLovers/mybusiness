import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { RpcContext } from '@mybusiness/contracts';
import { extractRpcContext } from '../context/extract-context';

export const tenantContextStorage = new AsyncLocalStorage<RpcContext>();

export function getTenantContext(): RpcContext | undefined {
  return tenantContextStorage.getStore();
}

@Injectable()
export class RpcTenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    let payload: unknown;
    try {
      payload = context.switchToRpc().getData();
    } catch {
      const req = context.switchToHttp().getRequest();
      payload = req?.user ?? req;
    }

    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      if (req?.user?.tenantId) {
        return this.runWithContext(extractRpcContext(req.user), next);
      }
    }

    const ctx = extractRpcContext(payload);
    if (ctx.tenantId) {
      return this.runWithContext(ctx, next);
    }

    return next.handle();
  }

  /**
   * Mantiene el contexto activo durante la suscripción y emisión del observable:
   * `AsyncLocalStorage.run` solo cubre la ejecución síncrona, y Nest invoca el
   * handler al suscribirse (por eso no basta con `run(ctx, () => next.handle())`).
   */
  private runWithContext(ctx: RpcContext, next: CallHandler): Observable<any> {
    return new Observable((subscriber) =>
      tenantContextStorage.run(ctx, () => next.handle().subscribe(subscriber)),
    );
  }
}

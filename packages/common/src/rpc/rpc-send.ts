import { HttpException, HttpStatus } from '@nestjs/common';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

export interface ClientProxyLike {
  send<TResult = any, TInput = any>(pattern: any, data: TInput): Observable<TResult>;
}

/**
 * Envoltorio para llamadas RPC sobre el transporte Redis de NestJS Microservices.
 * Aplica un timeout explícito (default 5000ms) para evitar que peticiones HTTP queden colgadas
 * cuando un microservicio receptor está caído o no responde.
 * Mapea TimeoutError a HTTP 503 Service Unavailable.
 */
export function rpcSend<TResult = any, TInput = any>(
  client: ClientProxyLike,
  pattern: any,
  data: TInput,
  timeoutMs: number = 5000,
): Observable<TResult> {
  return client.send<TResult, TInput>(pattern, data).pipe(
    timeout(timeoutMs),
    catchError((err: any) => {
      if (err instanceof TimeoutError || err?.name === 'TimeoutError') {
        return throwError(
          () =>
            new HttpException(
              {
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                message: `Microservicio no disponible o tiempo de espera agotado (${timeoutMs}ms)`,
                error: 'Service Unavailable',
              },
              HttpStatus.SERVICE_UNAVAILABLE,
            ),
        );
      }
      return throwError(() => err);
    }),
  );
}

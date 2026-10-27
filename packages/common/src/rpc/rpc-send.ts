import { HttpException, HttpStatus } from '@nestjs/common';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

export interface ClientProxyLike {
  send<TResult = any, TInput = any>(pattern: any, data: TInput): Observable<TResult>;
}

interface RpcErrorLike {
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
  error?: unknown;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && value >= 400 && value <= 599;
}

function toHttpException(error: unknown): HttpException | null {
  if (error instanceof HttpException) {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return null;
  }

  const rpcError = error as RpcErrorLike;
  const statusCode = isHttpStatus(rpcError.statusCode)
    ? rpcError.statusCode
    : isHttpStatus(rpcError.status)
      ? rpcError.status
      : null;

  if (statusCode === null) {
    return null;
  }

  const message =
    typeof rpcError.message === 'string' || Array.isArray(rpcError.message)
      ? rpcError.message
      : 'Error en el microservicio';
  const errorLabel = typeof rpcError.error === 'string' ? rpcError.error : 'Microservice Error';

  return new HttpException({ statusCode, message, error: errorLabel }, statusCode);
}

/**
 * Envoltorio para llamadas RPC sobre el transporte Redis de NestJS Microservices.
 * Aplica un timeout explícito (default 5000ms) para evitar que peticiones HTTP queden colgadas
 * cuando un microservicio receptor está caído o no responde.
 * Mapea TimeoutError a HTTP 503 y los errores estructurados del microservicio a HttpException.
 */
export function rpcSend<TResult = any, TInput = any>(
  client: ClientProxyLike,
  pattern: any,
  data: TInput,
  timeoutMs: number = 5000,
): Observable<TResult> {
  return client.send<TResult, TInput>(pattern, data).pipe(
    timeout(timeoutMs),
    catchError((err: unknown) => {
      if (
        err instanceof TimeoutError ||
        (err as { name?: string } | null)?.name === 'TimeoutError'
      ) {
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

      const httpException = toHttpException(err);

      return throwError(() => httpException ?? err);
    }),
  );
}

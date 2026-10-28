import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';

export interface RpcErrorPayload {
  statusCode: number;
  message: string | string[];
  error: string;
}

/**
 * Convierte las HttpException del microservicio en un payload RPC estructurado.
 * El filtro por defecto de Nest solo reconoce RpcException; sin esta traducción,
 * un 401 de Auth se convertiría en un 500 genérico en el Gateway.
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RpcExceptionFilter.name);

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const payload: RpcErrorPayload =
        typeof response === 'string'
          ? { statusCode, message: response, error: exception.name }
          : {
              ...(response as Omit<RpcErrorPayload, 'statusCode'>),
              statusCode,
              error:
                (response as { error?: string }).error ??
                (exception.name === 'HttpException' ? 'HTTP Exception' : exception.name),
            };

      return throwError(() => payload);
    }

    this.logger.error(
      'Excepción no controlada en el microservicio',
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    return throwError(
      () =>
        ({
          statusCode: 500,
          message: 'Internal server error',
          error: 'Internal Server Error',
        }) satisfies RpcErrorPayload,
    );
  }
}

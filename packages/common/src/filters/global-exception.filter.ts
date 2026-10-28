import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: hostType): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    this.logger.error(
      `[${request?.method || 'RPC'}] ${request?.url || ''} - Status: ${status}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    if (response && typeof response.status === 'function') {
      response.status(status).json({
        success: false,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request?.url,
        error: typeof message === 'object' ? message : { message },
      });
    }
  }
}
type hostType = ArgumentsHost;

import { HttpException } from '@nestjs/common';
import { rpcSend, type ClientProxyLike } from '@mybusiness/common';
import { firstValueFrom, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

function failingClient(error: unknown): ClientProxyLike {
  return {
    send: () => throwError(() => error),
  };
}

describe('rpcSend', () => {
  it('convierte un error estructurado del microservicio en HttpException', async () => {
    const error = await firstValueFrom(
      rpcSend(
        failingClient({
          statusCode: 401,
          message: 'Credenciales inválidas.',
          error: 'Unauthorized',
        }),
        'auth.login',
        {},
      ),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(401);
    expect((error as HttpException).getResponse()).toMatchObject({
      statusCode: 401,
      message: 'Credenciales inválidas.',
      error: 'Unauthorized',
    });
  });

  it('deja pasar errores no estructurados para que el filtro global decida', async () => {
    const original = new Error('fallo interno');
    const error = await firstValueFrom(rpcSend(failingClient(original), 'auth.login', {})).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(original);
  });
});

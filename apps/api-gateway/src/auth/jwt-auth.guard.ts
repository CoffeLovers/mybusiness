import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '@mybusiness/common';
import type { UserContext } from '@mybusiness/contracts';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from './auth-cookies';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserContext['role'];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: UserContext; cookies?: Record<string, string> }>();
    const authorization = request.headers.authorization;
    const bearer =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
    const token = bearer ?? request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      throw new UnauthorizedException('Access token requerido.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);

      request.user = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Access token inválido o expirado.');
    }
  }
}

import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthPatterns,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  type AuthTokensResponse,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Public, rpcSend } from '@mybusiness/common';
import { firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  accessCookieOptions,
  clearCookieOptions,
  refreshCookieOptions,
} from './auth-cookies';

type PublicSession = Pick<AuthTokensResponse, 'accessToken' | 'user'>;

@ApiTags('Auth')
@Controller('auth')
export class AuthGatewayController {
  constructor(
    @Inject('AUTH_SERVICE') private readonly authClient: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.call<AuthTokensResponse, RegisterDto>(AuthPatterns.REGISTER, dto);
    this.setSessionCookies(res, session);
    return this.publicSession(session);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.call<AuthTokensResponse, LoginDto>(AuthPatterns.LOGIN, dto);
    this.setSessionCookies(res, session);
    return this.publicSession(session);
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const refreshToken = request.cookies?.[REFRESH_TOKEN_COOKIE] ?? body?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido.');
    }

    const session = await this.call<AuthTokensResponse, RefreshTokenDto>(AuthPatterns.REFRESH, {
      refreshToken,
    });
    this.setSessionCookies(res, session);
    return this.publicSession(session);
  }

  @Public()
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const refreshToken = request.cookies?.[REFRESH_TOKEN_COOKIE] ?? body?.refreshToken;

    try {
      if (refreshToken) {
        await this.call<{ success: true }, RefreshTokenDto>(AuthPatterns.LOGOUT, {
          refreshToken,
        });
      }
    } finally {
      this.clearSessionCookies(res);
    }

    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  getProfile(@CurrentUser() user: UserContext) {
    return this.call(AuthPatterns.GET_PROFILE, user);
  }

  private call<TResult, TInput>(pattern: string, data: TInput): Promise<TResult> {
    return firstValueFrom(rpcSend<TResult, TInput>(this.authClient, pattern, data));
  }

  private publicSession(session: AuthTokensResponse): PublicSession {
    return {
      accessToken: session.accessToken,
      user: session.user,
    };
  }

  private setSessionCookies(res: Response, session: AuthTokensResponse): void {
    res.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, accessCookieOptions(this.config));
    res.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, refreshCookieOptions(this.config));
  }

  private clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, clearCookieOptions(this.config, '/'));
    res.clearCookie(
      REFRESH_TOKEN_COOKIE,
      clearCookieOptions(this.config, REFRESH_TOKEN_COOKIE_PATH),
    );
  }
}

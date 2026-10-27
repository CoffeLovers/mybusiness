import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { AuthPatterns, LoginDto, RegisterDto, RefreshTokenDto } from '@mybusiness/contracts';
import { CurrentUser, rpcSend } from '@mybusiness/common';

@ApiTags('Auth')
@Controller('auth')
export class AuthGatewayController {
  constructor(@Inject('AUTH_SERVICE') private readonly authClient: ClientProxy) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return rpcSend(this.authClient, AuthPatterns.REGISTER, dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return rpcSend(this.authClient, AuthPatterns.LOGIN, dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return rpcSend(this.authClient, AuthPatterns.REFRESH, dto);
  }

  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return rpcSend(this.authClient, AuthPatterns.GET_PROFILE, { user });
  }
}

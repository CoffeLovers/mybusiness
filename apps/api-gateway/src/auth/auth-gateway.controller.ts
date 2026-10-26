import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { AuthPatterns, LoginDto, RegisterDto, RefreshTokenDto } from '@mybusiness/contracts';
import { CurrentUser } from '@mybusiness/common';

@ApiTags('Auth')
@Controller('auth')
export class AuthGatewayController {
  constructor(@Inject('AUTH_SERVICE') private readonly authClient: ClientProxy) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authClient.send(AuthPatterns.REGISTER, dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authClient.send(AuthPatterns.LOGIN, dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authClient.send(AuthPatterns.REFRESH, dto);
  }

  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return this.authClient.send(AuthPatterns.GET_PROFILE, { user });
  }
}

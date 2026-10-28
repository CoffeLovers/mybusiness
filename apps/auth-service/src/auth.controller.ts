import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AuthPatterns,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  type UserContext,
} from '@mybusiness/contracts';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AuthPatterns.REGISTER)
  register(@Payload() data: RegisterDto) {
    return this.authService.register(data);
  }

  @MessagePattern(AuthPatterns.LOGIN)
  login(@Payload() data: LoginDto) {
    return this.authService.login(data);
  }

  @MessagePattern(AuthPatterns.REFRESH)
  refresh(@Payload() data: RefreshTokenDto) {
    return this.authService.refresh(data.refreshToken);
  }

  @MessagePattern(AuthPatterns.LOGOUT)
  logout(@Payload() data: RefreshTokenDto) {
    return this.authService.logout(data.refreshToken);
  }

  @MessagePattern(AuthPatterns.VALIDATE_TOKEN)
  validateToken(@Payload() data: { accessToken: string }) {
    return this.authService.validateToken(data.accessToken);
  }

  @MessagePattern(AuthPatterns.GET_PROFILE)
  getProfile(@Payload() user: UserContext) {
    return this.authService.getProfile(user);
  }
}

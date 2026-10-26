import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthPatterns, LoginDto, RefreshTokenDto, RegisterDto } from '@mybusiness/contracts';
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
    return this.authService.refresh(data);
  }

  @MessagePattern(AuthPatterns.GET_PROFILE)
  getProfile(@Payload() data: any) {
    return this.authService.getProfile(data);
  }
}

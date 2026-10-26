import { Injectable, Logger } from '@nestjs/common';
import { LoginDto, RefreshTokenDto, RegisterDto, UserRole } from '@mybusiness/contracts';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  async register(dto: RegisterDto) {
    this.logger.log(`Registrando nuevo tenant y usuario admin: ${dto.email}`);
    const tenantId = 'tenant-' + Math.random().toString(36).substring(2, 9);
    const userId = 'user-' + Math.random().toString(36).substring(2, 9);

    return {
      message: 'Usuario y empresa registrados satisfactoriamente',
      tenantId,
      user: {
        id: userId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.TENANT_ADMIN,
        companyName: dto.companyName,
      },
    };
  }

  async login(dto: LoginDto) {
    this.logger.log(`Intento de login para usuario: ${dto.email}`);
    return {
      accessToken: 'dummy-jwt-access-token',
      refreshToken: 'dummy-encrypted-refresh-token',
      user: {
        id: 'user-sample-id',
        email: dto.email,
        firstName: 'Alejandro',
        lastName: 'Demo',
        role: UserRole.TENANT_ADMIN,
        tenantId: 'tenant-sample-id',
      },
    };
  }

  async refresh(_dto: RefreshTokenDto) {
    this.logger.log(`Rotando refresh token...`);
    return {
      accessToken: 'new-dummy-jwt-access-token',
      refreshToken: 'new-dummy-encrypted-refresh-token',
    };
  }

  async getProfile(data: any) {
    return {
      profile: data.user || { email: 'demo@mybusiness.com', role: UserRole.TENANT_ADMIN },
    };
  }
}

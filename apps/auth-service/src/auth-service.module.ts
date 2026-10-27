import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRootEnvFilePaths } from '@mybusiness/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthServiceModule {}

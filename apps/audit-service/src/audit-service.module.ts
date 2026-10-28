import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  RpcTenantContextInterceptor,
  RpcTenantGuard,
  getRootEnvFilePaths,
} from '@mybusiness/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: APP_GUARD,
      useClass: RpcTenantGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RpcTenantContextInterceptor,
    },
  ],
})
export class AuditServiceModule {}

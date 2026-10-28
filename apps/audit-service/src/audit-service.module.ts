import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRootEnvFilePaths } from '@mybusiness/common';
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
  providers: [AuditService],
})
export class AuditServiceModule {}

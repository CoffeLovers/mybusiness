import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRootEnvFilePaths } from '@mybusiness/common';
import { AuditDatabaseService } from './database/database.service';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [AuditController],
  providers: [AuditDatabaseService, AuditRepository, AuditService],
  exports: [AuditService, AuditRepository],
})
export class AuditServiceModule {}

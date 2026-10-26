import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditServiceModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRootEnvFilePaths } from '@mybusiness/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceServiceModule {}

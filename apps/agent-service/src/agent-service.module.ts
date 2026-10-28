import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRootEnvFilePaths } from '@mybusiness/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentServiceModule {}

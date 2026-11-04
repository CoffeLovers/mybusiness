import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { FINANCE_EVENT_BUS, DomainEventPublisher } from './domain-event.publisher';

/**
 * Expone el publicador de eventos de dominio para que cualquier módulo del
 * finance-service pueda emitir eventos best-effort (por ejemplo auditoría de
 * replay de webhooks) sin duplicar el cliente Redis.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    DomainEventPublisher,
    {
      provide: FINANCE_EVENT_BUS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
    },
  ],
  exports: [DomainEventPublisher],
})
export class EventsModule {}

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

export const FINANCE_EVENT_BUS = 'FINANCE_EVENT_BUS';

/**
 * Publica eventos de dominio en el bus Redis. La publicación es best-effort:
 * un fallo del bus no revierte una transacción ya confirmada en base de datos.
 * La entrega durable (outbox/BullMQ) se aborda en la issue #15.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);

  constructor(@Inject(FINANCE_EVENT_BUS) private readonly client: ClientProxy) {}

  async publish<TPayload extends object>(pattern: string, payload: TPayload): Promise<void> {
    try {
      await firstValueFrom(this.client.emit(pattern, payload));
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`No se pudo publicar el evento ${pattern} (${name})`);
    }
  }
}

import { Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainEventPublisher } from '../src/events/domain-event.publisher';

function clientWith(emit: ClientProxy['emit']): ClientProxy {
  return { emit } as unknown as ClientProxy;
}

describe('DomainEventPublisher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publica el patrón y el payload en el bus', async () => {
    const payload = { invoiceId: 'inv-1' };
    const emit = vi.fn(() => of(payload));
    const publisher = new DomainEventPublisher(clientWith(emit));

    await publisher.publish('finance.invoice.paid', payload);

    expect(emit).toHaveBeenCalledWith('finance.invoice.paid', payload);
  });

  it('no propaga el error del bus y lo registra', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const emit = vi.fn(() => throwError(() => new Error('redis down')));
    const publisher = new DomainEventPublisher(clientWith(emit));

    await expect(publisher.publish('finance.invoice.paid', {})).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'No se pudo publicar el evento finance.invoice.paid (Error)',
    );
  });
});

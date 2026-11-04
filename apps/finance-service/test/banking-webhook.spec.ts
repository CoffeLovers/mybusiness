import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { BankProvider, UserRole } from '@mybusiness/contracts';
import { BankingWebhookService } from '../src/banking/banking-webhook.service';
import type { BankingAggregatorService } from '../src/banking/banking-aggregator.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { WebhookResult } from '../src/banking/adapters/base-adapter.interface';

type Row = Record<string, unknown>;

interface WebhookDbOptions {
  /** Filas devueltas por cada select en orden: dedupe/conexión/evento/conexión. */
  selectRows?: Row[][];
  /** Fila devuelta por el insert del evento (null = condición de carrera). */
  insertedEvent?: Row | null;
}

function createWebhookDatabaseMock(options: WebhookDbOptions = {}) {
  const selectRows = [...(options.selectRows ?? [])];
  const inserts: Row[] = [];
  const updates: Row[] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectRows.shift() ?? [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Row) => {
        inserts.push(values);
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue(
                options.insertedEvent === null
                  ? []
                  : [{ id: 'event-1', ...values, ...options.insertedEvent }],
              ),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Row) => {
        updates.push(values);
        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    })),
  };

  return { db, inserts, updates };
}

function createService(
  dbMock: ReturnType<typeof createWebhookDatabaseMock>,
  webhookResult: WebhookResult | Error,
  options: { enqueueError?: Error } = {},
) {
  const adapter = {
    provider: BankProvider.PLAID,
    handleWebhook: vi.fn(() => {
      if (webhookResult instanceof Error) {
        return Promise.reject(webhookResult);
      }
      return Promise.resolve(webhookResult);
    }),
  };
  const aggregator = {
    getAdapter: vi.fn(() => adapter),
  } as unknown as BankingAggregatorService;
  const database = { db: dbMock.db } as unknown as FinanceDatabaseService;
  const queue = {
    add: options.enqueueError
      ? vi.fn().mockRejectedValue(options.enqueueError)
      : vi.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };

  return {
    service: new BankingWebhookService(database, aggregator, queue as never, events as never),
    adapter,
    aggregator,
    queue,
    events,
  };
}

function plaidEvent(overrides: Partial<WebhookResult> = {}): WebhookResult {
  return {
    providerEventKey: 'event-key-1',
    webhookType: 'TRANSACTIONS',
    webhookCode: 'SYNC_UPDATES_AVAILABLE',
    providerItemId: 'item-1',
    rawPayload: {},
    occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

const ctx = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: UserRole.TENANT_ADMIN,
};

describe('BankingWebhookService.handleIncomingWebhook', () => {
  it('registra el evento como received y lo encola sin sincronizar inline', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
    });
    const { service, queue } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'TRANSACTIONS', item_id: 'item-1' },
      {},
      'raw-body',
    );

    expect(result).toEqual({ status: 'received', eventId: 'event-1' });
    expect(dbMock.inserts[0]).toMatchObject({
      provider: BankProvider.PLAID,
      providerEventKey: 'event-key-1',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
      connectionId: 'conn-1',
      processingStatus: 'received',
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    });
    expect(queue.add).toHaveBeenCalledWith(
      'banking-sync',
      expect.objectContaining({ eventId: 'event-1', connectionId: 'conn-1', force: false }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(dbMock.updates).toHaveLength(0);
  });

  it('devuelve already_processed sin insertar ni encolar cuando el evento ya fue procesado', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[{ id: 'existing-event', processingStatus: 'processed' }]],
    });
    const { service, queue } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'TRANSACTIONS' },
      {},
      'raw-body',
    );

    expect(result).toEqual({ status: 'already_processed', eventId: 'existing-event' });
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('reintenta el encolado de un duplicado que quedó en received', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [
        [{ id: 'existing-event', processingStatus: 'received', connectionId: 'conn-1' }],
      ],
    });
    const { service, queue } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'raw');

    expect(result).toEqual({ status: 'already_processed', eventId: 'existing-event' });
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('propaga UnauthorizedException del adapter sin persistir nada (fail-closed)', async () => {
    const dbMock = createWebhookDatabaseMock({ selectRows: [[]] });
    const { service } = createService(dbMock, new UnauthorizedException('Firma inválida'));

    await expect(
      service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'bad-body'),
    ).rejects.toThrow(UnauthorizedException);

    expect(dbMock.db.select).not.toHaveBeenCalled();
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(dbMock.updates).toHaveLength(0);
  });

  it.each([
    ['vacía', ''],
    ['demasiado larga', 'x'.repeat(256)],
  ])('rechaza providerEventKey %s con BadRequestException', async (_label, key) => {
    const dbMock = createWebhookDatabaseMock({ selectRows: [[]] });
    const { service } = createService(dbMock, plaidEvent({ providerEventKey: key }));

    await expect(service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'raw')).rejects.toThrow(
      BadRequestException,
    );

    expect(dbMock.db.select).not.toHaveBeenCalled();
    expect(dbMock.db.insert).not.toHaveBeenCalled();
  });

  it('marca ignored sin encolar cuando el evento no es accionable', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
    });
    const { service, queue } = createService(
      dbMock,
      plaidEvent({ webhookType: 'AUTH', webhookCode: 'AUTOMATICALLY_VERIFIED' }),
    );

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'AUTH' },
      {},
      'raw',
    );

    expect(result).toEqual({ status: 'ignored', eventId: 'event-1' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(dbMock.updates[0]).toMatchObject({
      processingStatus: 'ignored',
      errorMessage: 'evento_no_accionable',
    });
  });

  it('marca ignored cuando no se encuentra la conexión del item', async () => {
    const dbMock = createWebhookDatabaseMock({ selectRows: [[], []] });
    const { service, queue } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'raw');

    expect(result).toEqual({ status: 'ignored', eventId: 'event-1' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(dbMock.updates[0]).toMatchObject({
      processingStatus: 'ignored',
      errorMessage: 'conexion_no_encontrada',
    });
  });

  it('si el encolado falla marca failed y responde 503', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
    });
    const { service } = createService(dbMock, plaidEvent(), {
      enqueueError: new Error('Redis down'),
    });

    await expect(
      service.handleIncomingWebhook(
        BankProvider.PLAID,
        { webhook_type: 'TRANSACTIONS' },
        {},
        'raw',
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(dbMock.updates[0]).toMatchObject({
      processingStatus: 'failed',
      errorMessage: 'Redis down',
    });
  });

  it('si el insert pierde la carrera devuelve already_processed', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
      insertedEvent: null,
    });
    const { service, queue } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'raw');

    expect(result).toEqual({ status: 'already_processed' });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('BankingWebhookService.replayWebhook', () => {
  function replayService(selectRows: Row[][], enqueueError?: Error) {
    const dbMock = createWebhookDatabaseMock({ selectRows });
    const result = createService(dbMock, plaidEvent(), enqueueError ? { enqueueError } : {});
    return { ...result, dbMock };
  }

  it('reencola un evento failed, incrementa replayCount y audita la acción', async () => {
    const { service, queue, events, dbMock } = replayService([
      [
        {
          id: 'event-1',
          connectionId: 'conn-1',
          provider: 'plaid',
          processingStatus: 'failed',
          replayCount: 0,
        },
      ],
      [{ id: 'conn-1' }],
    ]);

    const result = await service.replayWebhook(ctx, 'event-1');

    expect(result).toEqual({
      eventId: 'event-1',
      status: 'received',
      enqueued: true,
      replayCount: 1,
    });
    expect(dbMock.updates[0]).toMatchObject({
      processingStatus: 'received',
      replayCount: 1,
      processedAt: null,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'banking-sync',
      expect.objectContaining({ eventId: 'event-1', connectionId: 'conn-1', force: false }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      'audit.log_event',
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'banking.webhook.replay',
        entityId: 'event-1',
        oldValues: expect.objectContaining({ processingStatus: 'failed' }),
        newValues: expect.objectContaining({ processingStatus: 'received', force: false }),
      }),
    );
  });

  it('permite reprocesar un ignored sólo con force=true', async () => {
    const ignoredEvent = {
      id: 'event-1',
      connectionId: 'conn-1',
      provider: 'plaid',
      processingStatus: 'ignored',
      errorMessage: 'evento_fuera_de_orden',
      replayCount: 1,
    };

    const withoutForce = replayService([[ignoredEvent], [{ id: 'conn-1' }]]);
    await expect(withoutForce.service.replayWebhook(ctx, 'event-1')).rejects.toThrow(
      ConflictException,
    );
    expect(withoutForce.queue.add).not.toHaveBeenCalled();

    const withForce = replayService([[ignoredEvent], [{ id: 'conn-1' }]]);
    const result = await withForce.service.replayWebhook(ctx, 'event-1', true);

    expect(result.replayCount).toBe(2);
    expect(withForce.queue.add).toHaveBeenCalledWith(
      'banking-sync',
      expect.objectContaining({ force: true }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  it.each(['processed', 'received'])('rechaza el replay de un evento %s', async (status) => {
    const { service } = replayService([
      [{ id: 'event-1', connectionId: 'conn-1', provider: 'plaid', processingStatus: status }],
      [{ id: 'conn-1' }],
    ]);

    await expect(service.replayWebhook(ctx, 'event-1')).rejects.toThrow(ConflictException);
  });

  it('no permite replay de un ignored que no fue descartado por orden', async () => {
    const { service, queue } = replayService([
      [
        {
          id: 'event-1',
          connectionId: 'conn-1',
          provider: 'plaid',
          processingStatus: 'ignored',
          errorMessage: 'evento_no_accionable',
          replayCount: 0,
        },
      ],
      [{ id: 'conn-1' }],
    ]);

    await expect(service.replayWebhook(ctx, 'event-1', true)).rejects.toThrow(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('oculta eventos de otro tenant como 404', async () => {
    const { service, queue } = replayService([
      [
        {
          id: 'event-1',
          connectionId: 'conn-1',
          provider: 'plaid',
          processingStatus: 'failed',
          replayCount: 0,
        },
      ],
      [],
    ]);

    await expect(service.replayWebhook(ctx, 'event-1')).rejects.toThrow(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el evento no existe', async () => {
    const { service } = replayService([[]]);

    await expect(service.replayWebhook(ctx, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('si el reencolado falla, deja el evento en failed y responde 503', async () => {
    const { service, dbMock } = replayService(
      [
        [
          {
            id: 'event-1',
            connectionId: 'conn-1',
            provider: 'plaid',
            processingStatus: 'failed',
            replayCount: 0,
          },
        ],
        [{ id: 'conn-1' }],
      ],
      new Error('Redis down'),
    );

    await expect(service.replayWebhook(ctx, 'event-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(dbMock.updates.at(-1)).toMatchObject({
      processingStatus: 'failed',
      errorMessage: 'Redis down',
    });
  });
});

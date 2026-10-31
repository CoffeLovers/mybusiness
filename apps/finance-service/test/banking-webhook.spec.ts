import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { BankProvider } from '@mybusiness/contracts';
import { BankingWebhookService } from '../src/banking/banking-webhook.service';
import type { BankingAggregatorService } from '../src/banking/banking-aggregator.service';
import type { BankingService } from '../src/banking/banking.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { WebhookResult } from '../src/banking/adapters/base-adapter.interface';

type Row = Record<string, unknown>;

interface WebhookDbOptions {
  /** Filas devueltas por cada select en orden: dedup, conexión. */
  selectRows?: Row[][];
  /** Si es true, la primera llamada a update().set().where() rechaza. */
  failFirstUpdate?: boolean;
  /** Fila devuelta por el insert del evento. */
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
        return {
          where: vi.fn(() => {
            if (options.failFirstUpdate && updates.length === 1) {
              return Promise.reject(new Error('DB connection drop'));
            }
            return Promise.resolve([]);
          }),
        };
      }),
    })),
  };

  return { db, inserts, updates };
}

function createService(
  dbMock: ReturnType<typeof createWebhookDatabaseMock>,
  webhookResult: WebhookResult | Error,
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
  const internalSyncConnection = vi.fn().mockResolvedValue({
    connectionId: 'conn-1',
    added: 0,
    modified: 0,
    removed: 0,
    hasMore: false,
    nextCursor: null,
  });
  const banking = { internalSyncConnection } as unknown as BankingService;
  const database = { db: dbMock.db } as unknown as FinanceDatabaseService;

  return {
    service: new BankingWebhookService(database, aggregator, banking),
    adapter,
    aggregator,
    internalSyncConnection,
  };
}

function plaidEvent(overrides: Partial<WebhookResult> = {}): WebhookResult {
  return {
    providerEventKey: 'event-key-1',
    webhookType: 'TRANSACTIONS',
    webhookCode: 'SYNC_UPDATES_AVAILABLE',
    providerItemId: 'item-1',
    rawPayload: {},
    ...overrides,
  };
}

describe('BankingWebhookService.handleIncomingWebhook', () => {
  it('procesa un evento nuevo de Plaid y dispara el sync de la conexión', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
    });
    const { service, internalSyncConnection } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'TRANSACTIONS', item_id: 'item-1' },
      {},
      'raw-body',
    );

    expect(result).toEqual({ status: 'processed', eventId: 'event-1' });
    expect(dbMock.inserts[0]).toMatchObject({
      provider: BankProvider.PLAID,
      providerEventKey: 'event-key-1',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
      connectionId: 'conn-1',
      processingStatus: 'pending',
    });
    expect(internalSyncConnection).toHaveBeenCalledWith('conn-1');
    expect(dbMock.updates[0]).toMatchObject({ processingStatus: 'processed' });
  });

  it('devuelve already_processed sin insertar cuando el evento ya existe', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[{ id: 'existing-event' }]],
    });
    const { service, internalSyncConnection } = createService(dbMock, plaidEvent());

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'TRANSACTIONS' },
      {},
      'raw-body',
    );

    expect(result).toEqual({ status: 'already_processed', eventId: 'existing-event' });
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(internalSyncConnection).not.toHaveBeenCalled();
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

  it('registra el error y propaga 5xx si falla la actualización de estado', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
      failFirstUpdate: true,
    });
    const { service } = createService(dbMock, plaidEvent());

    await expect(
      service.handleIncomingWebhook(
        BankProvider.PLAID,
        { webhook_type: 'TRANSACTIONS' },
        {},
        'raw',
      ),
    ).rejects.toThrow(InternalServerErrorException);

    // El segundo update (catch) persiste el estado failed con el mensaje de error.
    // Nota: el servicio relanza 5xx para forzar el reintento del proveedor; no devuelve
    // { status: 'failed' } como respuesta HTTP.
    expect(dbMock.updates).toHaveLength(2);
    expect(dbMock.updates[1]).toMatchObject({
      processingStatus: 'failed',
      errorMessage: 'DB connection drop',
    });
  });

  it('registra webhooks no soportados sin disparar sincronización', async () => {
    const dbMock = createWebhookDatabaseMock({
      selectRows: [[], [{ id: 'conn-1' }]],
    });
    const { service, internalSyncConnection } = createService(
      dbMock,
      plaidEvent({ webhookType: 'AUTH', webhookCode: 'AUTOMATICALLY_VERIFIED' }),
    );

    const result = await service.handleIncomingWebhook(
      BankProvider.PLAID,
      { webhook_type: 'AUTH' },
      {},
      'raw',
    );

    expect(result.status).toBe('processed');
    expect(internalSyncConnection).not.toHaveBeenCalled();
    expect(dbMock.updates[0]).toMatchObject({ processingStatus: 'processed' });
  });
});

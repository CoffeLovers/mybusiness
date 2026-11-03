import { describe, expect, it, vi } from 'vitest';
import { BankProvider } from '@mybusiness/contracts';
import { BankingWebhookProcessor } from '../src/banking/banking-webhook.processor';
import type { BankingService } from '../src/banking/banking.service';
import type { FinanceDatabaseService } from '../src/database/database.service';

type Row = Record<string, unknown>;

function createProcessor(selectRows: Row[][], syncError?: Error) {
  const selectRowsQueue = [...selectRows];
  const updates: Row[] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectRowsQueue.shift() ?? [])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Row) => {
        updates.push(values);
        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    })),
  };

  const internalSyncConnection = syncError
    ? vi.fn().mockRejectedValue(syncError)
    : vi.fn().mockResolvedValue({ connectionId: 'conn-1' });
  const banking = { internalSyncConnection } as unknown as BankingService;
  const database = { db } as unknown as FinanceDatabaseService;

  return {
    processor: new BankingWebhookProcessor(database, banking),
    updates,
    internalSyncConnection,
  };
}

const baseEvent = {
  id: 'event-1',
  connectionId: 'conn-1',
  provider: 'plaid',
  processingStatus: 'received',
  occurredAt: new Date('2026-10-01T12:00:00.000Z'),
  receivedAt: new Date('2026-10-01T12:01:00.000Z'),
};

const jobData = {
  eventId: 'event-1',
  connectionId: 'conn-1',
  provider: BankProvider.PLAID,
};

describe('BankingWebhookProcessor', () => {
  it('sincroniza y marca el evento como processed', async () => {
    const { processor, updates, internalSyncConnection } = createProcessor([[baseEvent], []]);

    await processor.process(jobData);

    expect(internalSyncConnection).toHaveBeenCalledWith('conn-1');
    expect(updates[0]).toMatchObject({ attempts: expect.anything() });
    expect(updates[1]).toMatchObject({
      processingStatus: 'processed',
      errorMessage: null,
      processedAt: expect.any(Date),
    });
  });

  it('marca failed y relanza si el sync falla para que BullMQ reintente', async () => {
    const { processor, updates } = createProcessor([[baseEvent], []], new Error('Plaid timeout'));

    await expect(processor.process(jobData)).rejects.toThrow('Plaid timeout');

    expect(updates[1]).toMatchObject({
      processingStatus: 'failed',
      errorMessage: 'Plaid timeout',
    });
  });

  it('ignora un evento más antiguo que otro ya procesado', async () => {
    const { processor, updates, internalSyncConnection } = createProcessor([
      [baseEvent],
      [{ id: 'newer-event' }],
    ]);

    await processor.process(jobData);

    expect(internalSyncConnection).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      processingStatus: 'ignored',
      errorMessage: 'evento_fuera_de_orden',
    });
  });

  it('force omite la guardia de orden', async () => {
    const { processor, internalSyncConnection } = createProcessor([
      [baseEvent],
      [{ id: 'newer-event' }],
    ]);

    await processor.process({ ...jobData, force: true });

    expect(internalSyncConnection).toHaveBeenCalledWith('conn-1');
  });

  it('no reprocesa un evento ya processed', async () => {
    const { processor, updates, internalSyncConnection } = createProcessor([
      [{ ...baseEvent, processingStatus: 'processed' }],
    ]);

    await processor.process(jobData);

    expect(internalSyncConnection).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('ignora eventos sin conexión asociada', async () => {
    const { processor, updates, internalSyncConnection } = createProcessor([
      [{ ...baseEvent, connectionId: null }],
    ]);

    await processor.process(jobData);

    expect(internalSyncConnection).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      processingStatus: 'ignored',
      errorMessage: 'conexion_no_encontrada',
    });
  });

  it('descarta jobs de eventos inexistentes', async () => {
    const { processor, updates } = createProcessor([[]]);

    await processor.process(jobData);

    expect(updates).toHaveLength(0);
  });
});

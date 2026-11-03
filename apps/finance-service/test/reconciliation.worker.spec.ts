import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ReconciliationWorker } from '../src/reconciliation/reconciliation.worker';
import type { BankingService } from '../src/banking/banking.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { ReconciliationTrigger } from '@mybusiness/contracts';

describe('ReconciliationWorker (Unit)', () => {
  let worker: ReconciliationWorker;
  let reconciliationServiceMock: { runForTenant: ReturnType<typeof vi.fn> };
  let bankingServiceMock: { internalSyncConnection: ReturnType<typeof vi.fn> };
  let dbMock: any;
  let configMock: ConfigService;

  beforeEach(() => {
    reconciliationServiceMock = {
      runForTenant: vi.fn().mockResolvedValue({ id: 'run-1' }),
    };

    bankingServiceMock = {
      internalSyncConnection: vi.fn().mockResolvedValue({ added: 5, modified: 0, removed: 0 }),
    };

    dbMock = {
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conn-1', institutionName: 'Bancolombia' },
          { id: 'conn-2', institutionName: 'Davivienda' },
        ]),
      },
    };

    configMock = new ConfigService({
      QUEUE_CONCURRENCY_RECONCILIATION: '5',
    });

    worker = new ReconciliationWorker(
      reconciliationServiceMock as unknown as ReconciliationService,
      bankingServiceMock as unknown as BankingService,
      dbMock as unknown as FinanceDatabaseService,
      configMock,
    );
  });

  it('sincroniza todas las conexiones activas y ejecuta runForTenant con éxito', async () => {
    const jobData = {
      tenantId: 'tenant-100',
      trigger: ReconciliationTrigger.NIGHTLY,
      from: '2026-10-01',
      to: '2026-10-10',
    };

    await worker.processJob(jobData);

    expect(dbMock.db.select).toHaveBeenCalled();
    expect(bankingServiceMock.internalSyncConnection).toHaveBeenCalledTimes(2);
    expect(bankingServiceMock.internalSyncConnection).toHaveBeenCalledWith('conn-1');
    expect(bankingServiceMock.internalSyncConnection).toHaveBeenCalledWith('conn-2');

    expect(reconciliationServiceMock.runForTenant).toHaveBeenCalledWith(
      'tenant-100',
      ReconciliationTrigger.NIGHTLY,
      '2026-10-01',
      '2026-10-10',
    );
  });

  it('continúa ante fallo parcial de una conexión y relanza el error al final para reintento de BullMQ', async () => {
    // conn-1 falla, conn-2 tiene éxito
    bankingServiceMock.internalSyncConnection
      .mockRejectedValueOnce(new Error('Plaid timeout'))
      .mockResolvedValueOnce({ added: 2 });

    const jobData = {
      tenantId: 'tenant-100',
      trigger: ReconciliationTrigger.NIGHTLY,
    };

    await expect(worker.processJob(jobData)).rejects.toThrow(
      /Fallo parcial al sincronizar 1 conexión\(es\)/,
    );

    // Se intentó sincronizar ambas conexiones a pesar del fallo de la primera
    expect(bankingServiceMock.internalSyncConnection).toHaveBeenCalledTimes(2);
    // Y aun así se ejecutó runForTenant para conciliar los datos que sí llegaron
    expect(reconciliationServiceMock.runForTenant).toHaveBeenCalledWith(
      'tenant-100',
      ReconciliationTrigger.NIGHTLY,
      undefined,
      undefined,
    );
  });
});

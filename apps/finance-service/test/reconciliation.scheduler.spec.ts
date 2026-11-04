import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { ReconciliationScheduler } from '../src/reconciliation/reconciliation.scheduler';
import type { FinanceDatabaseService } from '../src/database/database.service';

describe('ReconciliationScheduler (Unit)', () => {
  let queueMock: {
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    removeJobScheduler: ReturnType<typeof vi.fn>;
  };
  let dbMock: any;
  let scheduler: ReconciliationScheduler;

  beforeEach(() => {
    queueMock = {
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
      removeJobScheduler: vi.fn().mockResolvedValue({}),
    };

    dbMock = {
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { tenantId: 'tenant-1', timezone: 'America/Bogota' },
          { tenantId: 'tenant-2', timezone: 'America/Lima' },
        ]),
      },
    };

    scheduler = new ReconciliationScheduler(
      queueMock as unknown as Queue,
      dbMock as unknown as FinanceDatabaseService,
    );
  });

  it('onModuleInit programa los schedulers de todos los tenants con nightlyEnabled', async () => {
    await scheduler.onModuleInit();

    expect(dbMock.db.select).toHaveBeenCalled();
    expect(queueMock.upsertJobScheduler).toHaveBeenCalledTimes(2);

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      'reconciliation:tenant-1',
      { pattern: '0 2 * * *', tz: 'America/Bogota' },
      { name: 'nightly', data: { tenantId: 'tenant-1', trigger: 'NIGHTLY' } },
    );

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      'reconciliation:tenant-2',
      { pattern: '0 2 * * *', tz: 'America/Lima' },
      { name: 'nightly', data: { tenantId: 'tenant-2', trigger: 'NIGHTLY' } },
    );
  });

  it('scheduleNightly programa el scheduler con la zona horaria del tenant', async () => {
    await scheduler.scheduleNightly('tenant-abc', 'America/Mexico_City');

    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      'reconciliation:tenant-abc',
      { pattern: '0 2 * * *', tz: 'America/Mexico_City' },
      { name: 'nightly', data: { tenantId: 'tenant-abc', trigger: 'NIGHTLY' } },
    );
  });

  it('removeNightly elimina el scheduler del tenant', async () => {
    await scheduler.removeNightly('tenant-abc');

    expect(queueMock.removeJobScheduler).toHaveBeenCalledWith('reconciliation:tenant-abc');
  });

  it('onModuleInit no lanza excepción si falla la conexión a Redis o base de datos', async () => {
    dbMock.db.where.mockRejectedValue(new Error('Redis/DB no disponible'));

    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
  });
});

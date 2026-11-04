import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ReconciliationEvents,
  ReconciliationMatchStatus,
  ReconciliationRunStatus,
  ReconciliationTrigger,
  UserRole,
  type RequestContext,
} from '@mybusiness/contracts';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { DomainEventPublisher } from '../src/events/domain-event.publisher';
import type { ReconciliationScheduler } from '../src/reconciliation/reconciliation.scheduler';

describe('ReconciliationService (Unit)', () => {
  let service: ReconciliationService;
  let dbMock: any;
  let eventPublisherMock: { publish: ReturnType<typeof vi.fn> };
  let schedulerMock: {
    scheduleNightly: ReturnType<typeof vi.fn>;
    removeNightly: ReturnType<typeof vi.fn>;
  };
  let configMock: ConfigService;

  const ctx: RequestContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: UserRole.ACCOUNTANT,
  };

  const defaultSettings = {
    tenantId: ctx.tenantId,
    dateWindowDays: 5,
    autoMatchThresholdBps: 8500,
    timezone: 'America/Bogota',
    lookbackDays: 30,
    nightlyEnabled: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };

  beforeEach(() => {
    eventPublisherMock = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    schedulerMock = {
      scheduleNightly: vi.fn().mockResolvedValue(undefined),
      removeNightly: vi.fn().mockResolvedValue(undefined),
    };

    configMock = new ConfigService({
      RECONCILIATION_BATCH_SIZE: '500',
      OCR_CONFIDENCE_THRESHOLD: '0.85',
    });
  });

  describe('getSettings / updateSettings', () => {
    it('getSettings devuelve la configuración existente del tenant', async () => {
      dbMock = {
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([defaultSettings]),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.getSettings(ctx);
      expect(res.tenantId).toBe(ctx.tenantId);
      expect(res.dateWindowDays).toBe(5);
      expect(res.timezone).toBe('America/Bogota');
      expect(res.nightlyEnabled).toBe(true);
    });

    it('getSettings crea e inserta la configuración por defecto si no existía', async () => {
      dbMock = {
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]), // No existe
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([defaultSettings]),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.getSettings(ctx);
      expect(res.tenantId).toBe(ctx.tenantId);
      expect(dbMock.db.insert).toHaveBeenCalled();
    });

    it('updateSettings actualiza parámetros y sincroniza el scheduler si cambia la zona horaria', async () => {
      const updatedSettings = {
        ...defaultSettings,
        timezone: 'America/Lima',
        dateWindowDays: 7,
      };

      dbMock = {
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([defaultSettings]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([updatedSettings]),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.updateSettings(ctx, {
        timezone: 'America/Lima',
        dateWindowDays: 7,
      });

      expect(res.timezone).toBe('America/Lima');
      expect(res.dateWindowDays).toBe(7);
      expect(schedulerMock.scheduleNightly).toHaveBeenCalledWith(ctx.tenantId, 'America/Lima');
    });

    it('updateSettings elimina el cron scheduler si nightlyEnabled se desactiva', async () => {
      const disabledSettings = {
        ...defaultSettings,
        nightlyEnabled: false,
      };

      dbMock = {
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([defaultSettings]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([disabledSettings]),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await service.updateSettings(ctx, { nightlyEnabled: false });

      expect(schedulerMock.removeNightly).toHaveBeenCalledWith(ctx.tenantId);
    });
  });

  describe('runForTenant', () => {
    it('ejecuta conciliación, persiste matches y emite auditoría', async () => {
      const runId = 'run-1111-2222';
      const tx = {
        id: 'tx-1',
        amountMinor: -150000n,
        isoCurrencyCode: 'COP',
        date: '2026-10-01',
        name: 'AMAZON WEB SERVICES AWS-101',
        merchantName: 'Amazon Web Services',
      };
      const doc = {
        id: 'doc-1',
        totalMinor: 150000n,
        currency: 'COP',
        issueDate: '2026-10-01',
        createdAt: new Date(),
        providerName: 'Amazon Web Services Inc.',
        invoiceNumber: 'AWS-101',
        status: 'EXTRACTED',
        confidence: 0.95,
      };

      const selectMock = vi.fn();
      // Secuencia de llamadas de select:
      // 1: getOrCreateSettings -> [defaultSettings]
      // 2: activeMatches -> []
      // 3: unreconciled bank transactions -> [tx]
      // 4: candidate documents -> [doc]
      // 5: invoices -> [{ id: 'inv-1', documentId: 'doc-1' }]
      selectMock
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([defaultSettings]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([tx]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([doc]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ id: 'inv-1', documentId: 'doc-1' }]),
        });

      const insertMock = vi.fn();
      // 1. insert run (RUNNING)
      insertMock.mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        returning: vi
          .fn()
          .mockResolvedValue([{ id: runId, tenantId: ctx.tenantId, status: 'RUNNING' }]),
      });
      // 2. insert match (AUTO_MATCHED)
      insertMock.mockReturnValueOnce({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      });

      const updateMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          {
            id: runId,
            tenantId: ctx.tenantId,
            trigger: 'MANUAL',
            status: 'COMPLETED',
            startedAt: new Date(),
            finishedAt: new Date(),
            processed: 1,
            autoMatched: 1,
            needsReview: 0,
            errors: 0,
            errorMessage: null,
            createdAt: new Date(),
          },
        ]),
      });

      dbMock = {
        db: {
          select: selectMock,
          insert: insertMock,
          update: updateMock,
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.runForTenant(ctx.tenantId, ReconciliationTrigger.MANUAL);

      expect(res.status).toBe(ReconciliationRunStatus.COMPLETED);
      expect(res.autoMatched).toBe(1);
      expect(res.processed).toBe(1);
      expect(eventPublisherMock.publish).toHaveBeenCalledWith(
        ReconciliationEvents.RUN,
        expect.objectContaining({
          tenantId: ctx.tenantId,
          trigger: ReconciliationTrigger.MANUAL,
          runId,
          counters: { processed: 1, autoMatched: 1, needsReview: 0, errors: 0 },
        }),
      );
    });
  });

  describe('confirmReview / rejectReview', () => {
    it('confirmReview pasa a MANUAL_MATCHED y emite evento de auditoría', async () => {
      const matchId = 'match-100';
      const existing = {
        id: matchId,
        tenantId: ctx.tenantId,
        bankTransactionId: 'tx-1',
        documentId: 'doc-1',
        invoiceId: null,
        status: 'NEEDS_REVIEW',
        score: '0.800',
        rule: 'amount+date',
        evidence: { amountMinor: '1000' },
        matchedBy: null,
        matchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const selectMock = vi.fn();
      // 1. find match -> [existing]
      // 2. check conflicting active matches -> []
      // 3. getReviewItemDetail -> join row
      selectMock
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([existing]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              match: { ...existing, status: 'MANUAL_MATCHED', matchedBy: ctx.userId },
              tx: {
                id: 'tx-1',
                amountMinor: 1000n,
                isoCurrencyCode: 'USD',
                date: '2026-10-01',
                name: 'Tx',
                merchantName: null,
              },
              doc: {
                id: 'doc-1',
                originalName: 'doc.pdf',
                providerName: 'P',
                taxId: null,
                issueDate: null,
                currency: 'USD',
                totalMinor: 1000n,
                confidence: 0.9,
                invoiceNumber: null,
                status: 'EXTRACTED',
              },
              inv: null,
            },
          ]),
        });

      const updateMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...existing, status: 'MANUAL_MATCHED' }]),
      });

      dbMock = {
        db: {
          select: selectMock,
          update: updateMock,
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.confirmReview(ctx, matchId);

      expect(res.status).toBe(ReconciliationMatchStatus.MANUAL_MATCHED);
      expect(eventPublisherMock.publish).toHaveBeenCalledWith(
        ReconciliationEvents.MANUAL_MATCH,
        expect.objectContaining({
          tenantId: ctx.tenantId,
          matchId,
          matchedBy: ctx.userId,
        }),
      );
    });

    it('confirmReview lanza 404 si el match no existe o es de otro tenant', async () => {
      dbMock = {
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await expect(service.confirmReview(ctx, 'match-unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('confirmReview lanza 409 si el movimiento o documento ya tiene otra conciliación activa', async () => {
      const matchId = 'match-100';
      const existing = {
        id: matchId,
        tenantId: ctx.tenantId,
        bankTransactionId: 'tx-1',
        documentId: 'doc-1',
      };

      dbMock = {
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([existing]),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([{ id: 'other-active-match' }]),
            }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await expect(service.confirmReview(ctx, matchId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejectReview pasa a REJECTED y emite evento de auditoría', async () => {
      const matchId = 'match-200';
      const existing = {
        id: matchId,
        tenantId: ctx.tenantId,
        bankTransactionId: 'tx-2',
        documentId: 'doc-2',
        status: 'NEEDS_REVIEW',
        score: '0.600',
        rule: 'amount+date',
        evidence: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const selectMock = vi.fn();
      selectMock
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([existing]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              match: { ...existing, status: 'REJECTED' },
              tx: null,
              doc: null,
              inv: null,
            },
          ]),
        });

      dbMock = {
        db: {
          select: selectMock,
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([{ ...existing, status: 'REJECTED' }]),
          }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.rejectReview(ctx, matchId);
      expect(res.status).toBe(ReconciliationMatchStatus.REJECTED);
      expect(eventPublisherMock.publish).toHaveBeenCalledWith(
        ReconciliationEvents.REJECT,
        expect.objectContaining({
          tenantId: ctx.tenantId,
          matchId,
          rejectedBy: ctx.userId,
        }),
      );
    });
  });

  describe('manualMatch', () => {
    it('permite conciliar manualmente un movimiento y un documento del mismo importe', async () => {
      const tx = {
        id: 'tx-m',
        amountMinor: -85000n,
        isoCurrencyCode: 'COP',
        date: '2026-10-01',
        name: 'PAGO MANUAL',
        merchantName: 'Proveedor X',
      };
      const doc = {
        id: 'doc-m',
        totalMinor: 85000n,
        currency: 'COP',
        issueDate: '2026-10-01',
        createdAt: new Date(),
        providerName: 'Proveedor X',
        invoiceNumber: 'FAC-01',
        status: 'EXTRACTED',
        confidence: 0.95,
        originalName: 'doc.pdf',
        taxId: '123',
      };

      const selectMock = vi.fn();
      // 1. tx query -> [tx]
      // 2. doc query -> [doc]
      // 3. conflicting active matches -> []
      // 4. invoice query -> []
      // 5. getOrCreateSettings -> [defaultSettings]
      // 6. getReviewItemDetail -> row
      selectMock
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([tx]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([doc]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([defaultSettings]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              match: {
                id: 'match-manual-1',
                tenantId: ctx.tenantId,
                bankTransactionId: tx.id,
                documentId: doc.id,
                invoiceId: null,
                status: 'MANUAL_MATCHED',
                score: '1.000',
                rule: 'manual',
                evidence: {},
                matchedBy: ctx.userId,
                matchedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              tx,
              doc,
              inv: null,
            },
          ]),
        });

      dbMock = {
        db: {
          select: selectMock,
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnThis(),
            onConflictDoUpdate: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([{ id: 'match-manual-1' }]),
          }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const res = await service.manualMatch(ctx, {
        bankTransactionId: tx.id,
        documentId: doc.id,
      });

      expect(res.status).toBe(ReconciliationMatchStatus.MANUAL_MATCHED);
      expect(eventPublisherMock.publish).toHaveBeenCalledWith(
        ReconciliationEvents.MANUAL_MATCH,
        expect.objectContaining({
          tenantId: ctx.tenantId,
          bankTransactionId: tx.id,
          documentId: doc.id,
          matchedBy: ctx.userId,
        }),
      );
    });

    it('manualMatch rechaza si el movimiento bancario no pertenece al tenant (404)', async () => {
      dbMock = {
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
          }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await expect(
        service.manualMatch(ctx, { bankTransactionId: 'tx-other', documentId: 'doc-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('manualMatch rechaza si los importes absolutos difieren (400)', async () => {
      const tx = {
        id: 'tx-1',
        amountMinor: 100000n,
        isoCurrencyCode: 'COP',
        date: '2026-10-01',
        name: 'T',
      };
      const doc = { id: 'doc-1', totalMinor: 200000n, currency: 'COP', issueDate: '2026-10-01' };

      dbMock = {
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              innerJoin: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([tx]),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([doc]),
            }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await expect(
        service.manualMatch(ctx, { bankTransactionId: tx.id, documentId: doc.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('manualMatch rechaza con 409 si ya existe una conciliación activa', async () => {
      const tx = {
        id: 'tx-1',
        amountMinor: 100000n,
        isoCurrencyCode: 'COP',
        date: '2026-10-01',
        name: 'T',
      };
      const doc = { id: 'doc-1', totalMinor: 100000n, currency: 'COP', issueDate: '2026-10-01' };

      dbMock = {
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              innerJoin: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([tx]),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([doc]),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([{ id: 'active-match' }]),
            }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      await expect(
        service.manualMatch(ctx, { bankTransactionId: tx.id, documentId: doc.id }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getMetrics', () => {
    it('devuelve hasData=false y tasas en null cuando no hay ejecuciones ni matches', async () => {
      dbMock = {
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue([]),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              groupBy: vi.fn().mockResolvedValue([]),
            }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const metrics = await service.getMetrics(ctx);

      expect(metrics.hasData).toBe(false);
      expect(metrics.autoMatchRate).toBeNull();
      expect(metrics.reviewRate).toBeNull();
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalRuns).toBe(0);
    });

    it('calcula métricas y tasas correctamente cuando existen registros', async () => {
      const runs = [
        {
          id: 'r-1',
          tenantId: ctx.tenantId,
          trigger: 'MANUAL',
          status: 'COMPLETED',
          startedAt: new Date(),
          finishedAt: new Date(),
          processed: 10,
          autoMatched: 8,
          needsReview: 2,
          errors: 0,
          errorMessage: null,
          createdAt: new Date(),
        },
      ];

      const matchCounts = [
        { status: ReconciliationMatchStatus.AUTO_MATCHED, count: 8 },
        { status: ReconciliationMatchStatus.NEEDS_REVIEW, count: 2 },
      ];

      dbMock = {
        db: {
          select: vi
            .fn()
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue(runs),
            })
            .mockReturnValueOnce({
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              groupBy: vi.fn().mockResolvedValue(matchCounts),
            }),
        },
      };

      service = new ReconciliationService(
        dbMock as unknown as FinanceDatabaseService,
        eventPublisherMock as unknown as DomainEventPublisher,
        schedulerMock as unknown as ReconciliationScheduler,
        configMock,
      );

      const metrics = await service.getMetrics(ctx);

      expect(metrics.hasData).toBe(true);
      expect(metrics.autoMatchRate).toBe(0.8);
      expect(metrics.reviewRate).toBe(0.2);
      expect(metrics.totalProcessed).toBe(10);
      expect(metrics.totalAutoMatched).toBe(8);
      expect(metrics.totalNeedsReview).toBe(2);
      expect(metrics.totalRuns).toBe(1);
    });
  });
});

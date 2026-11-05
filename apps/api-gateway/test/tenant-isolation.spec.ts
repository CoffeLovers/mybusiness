import { describe, expect, it, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import {
  BankingPatterns,
  BankProvider,
  CashflowPatterns,
  DocumentPatterns,
  LedgerPatterns,
  ReconciliationPatterns,
  ReconciliationTrigger,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { BankingController } from '../src/banking/banking.controller';
import { BankingService } from '../src/banking/banking.service';
import { DocumentsController } from '../src/documents/documents.controller';
import { DocumentsService } from '../src/documents/documents.service';
import { FinanceGatewayController } from '../src/finance/finance-gateway.controller';
import { LedgerController } from '../src/ledger/ledger.controller';
import { LedgerService } from '../src/ledger/ledger.service';
import { ReconciliationController } from '../src/reconciliation/reconciliation.controller';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

describe('Aislamiento por Tenant A/B (API Gateway Unit Specs)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  const TENANT_B = '00000000-0000-0000-0000-000000000002';

  const userA: UserContext = {
    userId: 'user-a-1',
    tenantId: TENANT_A,
    email: 'user-a@example.com',
    role: UserRole.TENANT_ADMIN,
  };

  const userB: UserContext = {
    userId: 'user-b-1',
    tenantId: TENANT_B,
    email: 'user-b@example.com',
    role: UserRole.TENANT_ADMIN,
  };

  let mockClientProxy: {
    send: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClientProxy = {
      send: vi.fn().mockImplementation((pattern: string, data: any) => {
        // Simular rechazo en microservicio si se accede a recursos de otro tenant
        if (data?.connectionId === 'conn-a-only' && data?.tenantId !== TENANT_A) {
          return throwError(() => new NotFoundException('Conexión no encontrada para este tenant'));
        }
        if (
          (data?.documentId === 'doc-a-only' || data?.id === 'doc-a-only') &&
          data?.tenantId !== TENANT_A
        ) {
          return throwError(
            () => new NotFoundException('Documento no encontrado para este tenant'),
          );
        }
        if (
          (data?.matchId === 'rev-a-only' || data?.id === 'rev-a-only') &&
          data?.tenantId !== TENANT_A
        ) {
          return throwError(() => new NotFoundException('Caso de conciliación no encontrado'));
        }
        if (data?.transactionId === 'tx-a-only' && data?.tenantId !== TENANT_A) {
          return throwError(() => new NotFoundException('Transacción no encontrada'));
        }

        if (pattern === BankingPatterns.GET_CONNECTIONS) {
          return of(data.tenantId === TENANT_A ? [{ id: 'conn-a-only' }] : [{ id: 'conn-b-only' }]);
        }
        if (pattern === CashflowPatterns.SUMMARY) {
          return of({
            hasData: true,
            tenantId: data.tenantId,
            currency: 'EUR',
            balanceMinor: data.tenantId === TENANT_A ? '4500000' : '9900000',
          });
        }
        if (pattern === LedgerPatterns.LIST) {
          return of({
            rows: [{ id: `row-${data.tenantId}`, tenantId: data.tenantId }],
            total: 1,
            page: 1,
            pageSize: 50,
            hasMore: false,
          });
        }
        if (pattern === ReconciliationPatterns.GET_METRICS) {
          return of({
            totalMatches: data.tenantId === TENANT_A ? 10 : 2,
            autoMatched: data.tenantId === TENANT_A ? 8 : 1,
          });
        }

        return of({ success: true, tenantId: data.tenantId, data });
      }),
      emit: vi.fn().mockReturnValue(of(true)),
    };
  });

  describe('1. Módulo Banking', () => {
    let bankingController: BankingController;
    let bankingService: BankingService;

    beforeEach(() => {
      bankingService = new BankingService(mockClientProxy as any);
      bankingController = new BankingController(bankingService);
    });

    it('connect propaga exclusivamente el tenantId del token y no permite sobreescritura', async () => {
      await bankingController.connect(userA, { provider: BankProvider.PLAID });

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.CREATE_LINK_OR_CONNECT,
        expect.objectContaining({
          tenantId: TENANT_A,
          userId: userA.userId,
          role: userA.role,
        }),
      );
    });

    it('exchange propaga exclusivamente el tenantId autenticado de Tenant B', async () => {
      await bankingController.exchange(userB, {
        provider: BankProvider.PLAID,
        publicToken: 'sandbox-public-token',
      });

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.EXCHANGE_CONNECTION,
        expect.objectContaining({
          tenantId: TENANT_B,
          userId: userB.userId,
        }),
      );
    });

    it('getConnections retorna únicamente las conexiones del tenant solicitante', async () => {
      const resA = await firstValueFrom(bankingController.getConnections(userA));
      expect(resA).toEqual([{ id: 'conn-a-only' }]);

      const resB = await firstValueFrom(bankingController.getConnections(userB));
      expect(resB).toEqual([{ id: 'conn-b-only' }]);
    });

    it('Tenant B recibe NotFoundException al intentar listar cuentas de una conexión de Tenant A', async () => {
      await expect(
        firstValueFrom(bankingController.getConnectionAccounts(userB, 'conn-a-only')),
      ).rejects.toThrow(NotFoundException);
    });

    it('Tenant B recibe NotFoundException al intentar sincronizar conexión de Tenant A', async () => {
      await expect(
        firstValueFrom(bankingController.syncConnection(userB, 'conn-a-only')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('2. Módulo Documents', () => {
    let documentsController: DocumentsController;
    let documentsService: DocumentsService;

    beforeEach(() => {
      documentsService = new DocumentsService(mockClientProxy as any);
      documentsController = new DocumentsController(documentsService);
    });

    it('create documento propaga tenantId del token', () => {
      const mockFile = {
        buffer: Buffer.from('%PDF-1.7 factura de prueba'),
        mimetype: 'application/pdf',
        originalname: 'factura.pdf',
        size: 1024,
      } as Express.Multer.File;

      documentsController.create(userA, mockFile);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        DocumentPatterns.CREATE,
        expect.objectContaining({
          tenantId: TENANT_A,
          userId: userA.userId,
          originalName: 'factura.pdf',
        }),
      );
    });

    it('search propaga tenantId autenticado', () => {
      documentsController.search(userA, { q: 'factura' } as any);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        DocumentPatterns.SEARCH,
        expect.objectContaining({
          tenantId: TENANT_A,
          q: 'factura',
        }),
      );
    });

    it('Tenant B recibe NotFoundException al solicitar documento de Tenant A', async () => {
      await expect(firstValueFrom(documentsController.get(userB, 'doc-a-only'))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('3. Módulo Cashflow', () => {
    let financeController: FinanceGatewayController;

    beforeEach(() => {
      financeController = new FinanceGatewayController(mockClientProxy as any);
    });

    it('getCashflowSummary devuelve datos de Tenant A cuando consulta User A', async () => {
      const resA: any = await firstValueFrom(
        financeController.getCashflowSummary(userA, {
          from: '2026-10-01',
          to: '2026-10-31',
        } as any),
      );

      expect(resA.tenantId).toBe(TENANT_A);
      expect(resA.balanceMinor).toBe('4500000');
    });

    it('getCashflowSummary devuelve datos de Tenant B cuando consulta User B', async () => {
      const resB: any = await firstValueFrom(
        financeController.getCashflowSummary(userB, {
          from: '2026-10-01',
          to: '2026-10-31',
        } as any),
      );

      expect(resB.tenantId).toBe(TENANT_B);
      expect(resB.balanceMinor).toBe('9900000');
    });
  });

  describe('4. Módulo Ledger', () => {
    let ledgerController: LedgerController;
    let ledgerService: LedgerService;

    beforeEach(() => {
      ledgerService = new LedgerService(mockClientProxy as any);
      ledgerController = new LedgerController(ledgerService);
    });

    it('list ledger aísla por tenantId del token', async () => {
      const resA: any = await firstValueFrom(
        ledgerController.list(userA, { page: 1, pageSize: 50 }),
      );
      expect(resA.rows[0].tenantId).toBe(TENANT_A);

      const resB: any = await firstValueFrom(
        ledgerController.list(userB, { page: 1, pageSize: 50 }),
      );
      expect(resB.rows[0].tenantId).toBe(TENANT_B);
    });

    it('update propaga tenantId del token', async () => {
      await firstValueFrom(
        ledgerController.update(userA, 'tx-1', {
          notes: 'Nota privada de Tenant A',
        }),
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        LedgerPatterns.UPDATE,
        expect.objectContaining({
          tenantId: TENANT_A,
          transactionId: 'tx-1',
          notes: 'Nota privada de Tenant A',
        }),
      );
    });

    it('bulkCategorize propaga tenantId del token', async () => {
      await firstValueFrom(
        ledgerController.bulkCategorize(userA, {
          transactionIds: ['tx-1', 'tx-2'],
          categoryId: 'cat-1',
        }),
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        LedgerPatterns.BULK_CATEGORIZE,
        expect.objectContaining({
          tenantId: TENANT_A,
          transactionIds: ['tx-1', 'tx-2'],
          categoryId: 'cat-1',
        }),
      );
    });
  });

  describe('5. Módulo Reconciliation', () => {
    let reconciliationController: ReconciliationController;
    let reconciliationService: ReconciliationService;

    beforeEach(() => {
      reconciliationService = new ReconciliationService(mockClientProxy as any);
      reconciliationController = new ReconciliationController(reconciliationService);
    });

    it('getSettings propaga tenantId del token', async () => {
      await firstValueFrom(reconciliationController.getSettings(userA));

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ReconciliationPatterns.GET_SETTINGS,
        expect.objectContaining({ tenantId: TENANT_A }),
      );
    });

    it('updateSettings propaga tenantId del token', async () => {
      await firstValueFrom(
        reconciliationController.updateSettings(userA, {
          dateWindowDays: 10,
          autoMatchThresholdBps: 9500,
          timezone: 'UTC',
        }),
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ReconciliationPatterns.UPDATE_SETTINGS,
        expect.objectContaining({
          tenantId: TENANT_A,
          dateWindowDays: 10,
        }),
      );
    });

    it('getMetrics aísla métricas entre Tenant A y Tenant B', async () => {
      const resA: any = await firstValueFrom(reconciliationController.getMetrics(userA, {} as any));
      expect(resA.totalMatches).toBe(10);

      const resB: any = await firstValueFrom(reconciliationController.getMetrics(userB, {} as any));
      expect(resB.totalMatches).toBe(2);
    });

    it('Tenant B no puede confirmar una revisión de conciliación perteneciente a Tenant A', async () => {
      await expect(
        firstValueFrom(reconciliationController.confirmReview(userB, 'rev-a-only')),
      ).rejects.toThrow(NotFoundException);
    });

    it('Tenant B no puede rechazar una revisión de conciliación perteneciente a Tenant A', async () => {
      await expect(
        firstValueFrom(reconciliationController.rejectReview(userB, 'rev-a-only')),
      ).rejects.toThrow(NotFoundException);
    });

    it('run asocia la ejecución al tenant del usuario autenticado', async () => {
      await firstValueFrom(
        reconciliationController.run(userA, {
          trigger: ReconciliationTrigger.MANUAL,
        }),
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ReconciliationPatterns.RUN,
        expect.objectContaining({
          tenantId: TENANT_A,
          trigger: ReconciliationTrigger.MANUAL,
        }),
      );
    });
  });
});

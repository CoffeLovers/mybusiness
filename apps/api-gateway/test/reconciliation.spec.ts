import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import {
  ReconciliationPatterns,
  ReconciliationTrigger,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { ReconciliationController } from '../src/reconciliation/reconciliation.controller';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@mybusiness/common';

describe('Reconciliation Gateway Unit Tests', () => {
  let send: ReturnType<typeof vi.fn>;
  let controller: ReconciliationController;
  let service: ReconciliationService;
  const reflector = new Reflector();

  const user: UserContext = {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    email: 'accountant@mybusiness.com',
    role: UserRole.ACCOUNTANT,
  };

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({ success: true }));
    const client = { send } as any;
    service = new ReconciliationService(client);
    controller = new ReconciliationController(service);
  });

  describe('Endpoints y propagación de contexto RPC', () => {
    it('getSettings propaga tenantId y userId autenticados', async () => {
      await controller.getSettings(user);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.GET_SETTINGS,
        expect.objectContaining({
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('updateSettings propaga DTO y contexto autenticado', async () => {
      const dto = {
        dateWindowDays: 7,
        timezone: 'America/Lima',
        autoMatchThresholdBps: 9000,
      };

      await controller.updateSettings(user, dto);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.UPDATE_SETTINGS,
        expect.objectContaining({
          ...dto,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('run propaga trigger, fechas y contexto autenticado', async () => {
      const dto = {
        trigger: ReconciliationTrigger.MANUAL,
        from: '2026-10-01',
        to: '2026-10-15',
      };

      await controller.run(user, dto);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.RUN,
        expect.objectContaining({
          ...dto,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('listReview propaga cursor, limit y contexto autenticado', async () => {
      const query = {
        cursor: 'match-100',
        limit: 10,
      };

      await controller.listReview(user, query);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.LIST_REVIEW,
        expect.objectContaining({
          ...query,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('confirmReview propaga matchId y contexto', async () => {
      const matchId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      await controller.confirmReview(user, matchId);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.CONFIRM_REVIEW,
        expect.objectContaining({
          matchId,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('rejectReview propaga matchId y contexto', async () => {
      const matchId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      await controller.rejectReview(user, matchId);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.REJECT_REVIEW,
        expect.objectContaining({
          matchId,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('manualMatch propaga IDs y contexto autenticado', async () => {
      const dto = {
        bankTransactionId: '11111111-2222-3333-4444-555555555555',
        documentId: '66666666-7777-8888-9999-000000000000',
      };

      await controller.manualMatch(user, dto);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.MANUAL_MATCH,
        expect.objectContaining({
          ...dto,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });

    it('getMetrics propaga rango de fechas y contexto', async () => {
      const query = {
        from: '2026-10-01',
        to: '2026-10-31',
      };

      await controller.getMetrics(user, query);

      expect(send).toHaveBeenCalledWith(
        ReconciliationPatterns.GET_METRICS,
        expect.objectContaining({
          ...query,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
        }),
      );
    });
  });

  describe('Control de Acceso Basado en Roles (RBAC)', () => {
    it('protege updateSettings con roles TENANT_ADMIN y ACCOUNTANT', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, controller.updateSettings);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.TENANT_ADMIN);
      expect(roles).toContain(UserRole.ACCOUNTANT);
    });

    it('protege run con roles TENANT_ADMIN y ACCOUNTANT', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, controller.run);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.TENANT_ADMIN);
      expect(roles).toContain(UserRole.ACCOUNTANT);
    });

    it('protege confirmReview y rejectReview con roles autorizados', () => {
      const confirmRoles = reflector.get<UserRole[]>(ROLES_KEY, controller.confirmReview);
      expect(confirmRoles).toContain(UserRole.TENANT_ADMIN);
      expect(confirmRoles).toContain(UserRole.ACCOUNTANT);

      const rejectRoles = reflector.get<UserRole[]>(ROLES_KEY, controller.rejectReview);
      expect(rejectRoles).toContain(UserRole.TENANT_ADMIN);
      expect(rejectRoles).toContain(UserRole.ACCOUNTANT);
    });

    it('protege manualMatch con roles TENANT_ADMIN y ACCOUNTANT', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, controller.manualMatch);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.TENANT_ADMIN);
      expect(roles).toContain(UserRole.ACCOUNTANT);
    });
  });
});

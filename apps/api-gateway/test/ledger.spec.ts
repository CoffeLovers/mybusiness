import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, of } from 'rxjs';
import type { Response } from 'express';
import {
  BulkCategorizeDto,
  LedgerPatterns,
  LedgerQueryDto,
  SaveLedgerViewDto,
  UpdateLedgerTransactionDto,
  UserRole,
  type LedgerCsvExportResponse,
  type UserContext,
} from '@mybusiness/contracts';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerController } from '../src/ledger/ledger.controller';

const user: UserContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  email: 'ada@example.com',
  role: UserRole.ACCOUNTANT,
};

const OTHER_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SECOND_UUID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const contextPayload = {
  tenantId: user.tenantId,
  userId: user.userId,
  role: user.role,
};

interface FakeResponse {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
  };
}

describe('Ledger Gateway', () => {
  let send: ReturnType<typeof vi.fn>;
  let service: LedgerService;
  let controller: LedgerController;
  let validationPipe: ValidationPipe;

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({}));
    service = new LedgerService({ send } as unknown as ClientProxy);
    controller = new LedgerController(service);
    validationPipe = new ValidationPipe({ transform: true, whitelist: true });
  });

  it('list propaga el contexto autenticado y descarta tenantId inyectado en el query', async () => {
    send.mockReturnValue(of({ rows: [], total: 0, page: 1, pageSize: 10, hasMore: false }));

    const metadata: ArgumentMetadata = { type: 'query', metatype: LedgerQueryDto };
    const query = (await validationPipe.transform(
      { page: '2', pageSize: '10', q: 'acme', tenantId: 'tenant-inyectado' },
      metadata,
    )) as LedgerQueryDto;

    const response = await firstValueFrom(controller.list(user, query));

    expect(send).toHaveBeenCalledWith(LedgerPatterns.LIST, {
      page: 2,
      pageSize: 10,
      q: 'acme',
      ...contextPayload,
    });
    const [, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.tenantId).toBe(user.tenantId);
    expect(Object.values(payload)).not.toContain('tenant-inyectado');
    expect(response.total).toBe(0);
  });

  it('update propaga el transactionId dentro del payload', async () => {
    send.mockReturnValue(of({ id: OTHER_UUID }));

    const dto: UpdateLedgerTransactionDto = { category: 'Ventas', notes: 'Ajuste manual' };
    await firstValueFrom(service.update(user, OTHER_UUID, dto));

    expect(send).toHaveBeenCalledWith(LedgerPatterns.UPDATE, {
      transactionId: OTHER_UUID,
      category: 'Ventas',
      notes: 'Ajuste manual',
      ...contextPayload,
    });
  });

  it('bulkCategorize propaga ids y categoría', async () => {
    send.mockReturnValue(of({ updated: 2, requested: 2 }));

    const dto: BulkCategorizeDto = { ids: [OTHER_UUID, SECOND_UUID], category: 'Operativo' };
    const result = await firstValueFrom(controller.bulkCategorize(user, dto));

    expect(send).toHaveBeenCalledWith(LedgerPatterns.BULK_CATEGORIZE, {
      ids: [OTHER_UUID, SECOND_UUID],
      category: 'Operativo',
      ...contextPayload,
    });
    expect(result).toEqual({ updated: 2, requested: 2 });
  });

  it('export devuelve el contenido y el controlador fija las cabeceras de descarga', async () => {
    const file: LedgerCsvExportResponse = {
      filename: 'libro-mayor-20260105.csv',
      contentType: 'text/csv; charset=utf-8',
      content: '\uFEFFfecha,descripcion\r\n2026-01-01,Compra\r\n',
      rowCount: 1,
    };
    send.mockReturnValue(of(file));

    const res = fakeResponse();
    const body = await controller.export(user, {}, res as unknown as Response);

    expect(send).toHaveBeenCalledWith(LedgerPatterns.EXPORT_CSV, { ...contextPayload });
    expect(body).toBe(file.content);
    expect(res.headers['Content-Type']).toBe(file.contentType);
    expect(res.headers['Content-Disposition']).toBe(`attachment; filename="${file.filename}"`);
  });

  it('createSavedView propaga el nombre y el query de la vista', async () => {
    send.mockReturnValue(of({ id: OTHER_UUID, name: 'Mi vista' }));

    const dto: SaveLedgerViewDto = { name: 'Mi vista', query: { q: 'acme', sortBy: undefined } };
    await firstValueFrom(controller.createSavedView(user, dto));

    expect(send).toHaveBeenCalledWith(LedgerPatterns.SAVED_VIEW_CREATE, {
      name: 'Mi vista',
      query: { q: 'acme', sortBy: undefined },
      ...contextPayload,
    });
  });

  it('RBAC: las mutaciones exigen roles contables y la lectura queda abierta', () => {
    const expected = [UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN];

    expect(Reflect.getMetadata('roles', LedgerController.prototype.update)).toEqual(expected);
    expect(Reflect.getMetadata('roles', LedgerController.prototype.bulkCategorize)).toEqual(
      expected,
    );
    expect(Reflect.getMetadata('roles', LedgerController.prototype.createSavedView)).toEqual(
      expected,
    );
    expect(Reflect.getMetadata('roles', LedgerController.prototype.deleteSavedView)).toEqual(
      expected,
    );
    expect(Reflect.getMetadata('roles', LedgerController.prototype.list)).toBeUndefined();
    expect(Reflect.getMetadata('roles', LedgerController.prototype.export)).toBeUndefined();
  });
});

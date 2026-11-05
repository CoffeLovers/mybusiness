import { describe, expect, it, vi } from 'vitest';
import { PayPalOrderStatus } from '@mybusiness/contracts';
import { PaymentsRepository } from '../src/payments/payments.repository';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { PayPalOrder } from '../src/database/schema';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';

function orderRow(overrides: Partial<PayPalOrder> = {}): PayPalOrder {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantId: TENANT_ID,
    invoiceId: INVOICE_ID,
    status: PayPalOrderStatus.CREATED,
    amountMinor: 250000n,
    currency: 'COP',
    paypalOrderId: 'PAYPAL-123',
    idempotencyKey: 'idem-1',
    checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123',
    providerResponse: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface ChainSpy {
  values: ReturnType<typeof vi.fn>;
  onConflict: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

/**
 * Cadena fluida de Drizzle simulada para no depender de PostgreSQL:
 * `insert().values().onConflictDoNothing().returning()` y
 * `select().from().where().limit()`.
 */
function fakeDb(options: { returning: unknown; found: unknown }): { db: unknown; chain: ChainSpy } {
  const returning = vi.fn().mockResolvedValue(options.returning);
  const onConflict = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing: onConflict }));
  const insert = vi.fn(() => ({ values }));

  const limit = vi.fn().mockResolvedValue(options.found);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { insert, select },
    chain: { values, onConflict, returning, where, limit },
  };
}

function repositoryWith(db: unknown): {
  repository: PaymentsRepository;
  database: { db: unknown };
} {
  const database = { db } as unknown as FinanceDatabaseService;
  return { repository: new PaymentsRepository(database), database };
}

const record = {
  tenantId: TENANT_ID,
  invoiceId: INVOICE_ID,
  amountMinor: 250000n,
  currency: 'COP',
  paypalOrderId: 'PAYPAL-123',
  idempotencyKey: 'idem-1',
  checkoutUrl: 'https://x/y',
  providerResponse: { id: 'PAYPAL-123' },
};

describe('PaymentsRepository', () => {
  it('createOrderIdempotent inserta y reporta created con la fila nueva', async () => {
    const row = orderRow();
    const { db, chain } = fakeDb({ returning: [row], found: [] });
    const { repository } = repositoryWith(db);

    const result = await repository.createOrderIdempotent(record);

    expect(result.created).toBe(true);
    expect(result.order.id).toBe(row.id);
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        idempotencyKey: 'idem-1',
        amountMinor: 250000n,
        providerResponse: { id: 'PAYPAL-123' },
      }),
    );
    expect(chain.onConflict).toHaveBeenCalledWith({
      target: expect.anything(),
    });
  });

  it('en carrera, el conflicto de idempotencia recurre al select y devuelve la fila original sin crear otra', async () => {
    const existing = orderRow({ idempotencyKey: 'idem-1' });
    // `returning` resuelve vacío porque otra réplica ganó el INSERT concurrente.
    const { db, chain } = fakeDb({ returning: [], found: [existing] });
    const { repository } = repositoryWith(db);

    const result = await repository.createOrderIdempotent(record);

    expect(result.created).toBe(false);
    expect(result.order.id).toBe(existing.id);
    expect(result.order.idempotencyKey).toBe('idem-1');
    // El select de fallback filtra por tenant + clave (aislamiento multi-tenant).
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('si la fila ganadora no es resolvible, lanza el error estable sin inventar una orden', async () => {
    const { db } = fakeDb({ returning: [], found: [] });
    const { repository } = repositoryWith(db);

    await expect(repository.createOrderIdempotent(record)).rejects.toThrow(
      'No se pudo resolver la orden idempotente',
    );
  });

  it('findOrderByIdempotencyKey devuelve la orden del tenant y null para clave ajena', async () => {
    const found = fakeDb({ returning: [], found: [orderRow()] });
    const { repository: repoFound } = repositoryWith(found.db);
    const empty = fakeDb({ returning: [], found: [] });
    const { repository: repoEmpty } = repositoryWith(empty.db);

    await expect(repoFound.findOrderByIdempotencyKey(TENANT_ID, 'idem-1')).resolves.toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    await expect(repoEmpty.findOrderByIdempotencyKey(TENANT_ID, 'desconocida')).resolves.toBeNull();
  });

  it('findInvoiceById resuelve la moneda dentro del tenant y null fuera de él', async () => {
    const found = fakeDb({ returning: [], found: [{ currency: 'COP' }] });
    const { repository: repoFound } = repositoryWith(found.db);
    const empty = fakeDb({ returning: [], found: [] });
    const { repository: repoEmpty } = repositoryWith(empty.db);

    await expect(repoFound.findInvoiceById(TENANT_ID, INVOICE_ID)).resolves.toEqual({
      currency: 'COP',
    });
    await expect(repoEmpty.findInvoiceById(TENANT_ID, INVOICE_ID)).resolves.toBeNull();
  });
});

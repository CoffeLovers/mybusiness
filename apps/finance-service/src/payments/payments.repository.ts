import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { FinanceDatabaseService } from '../database/database.service';
import { invoices, paypalOrders, type PayPalOrder } from '../database/schema';

export interface CreatePayPalOrderRecord {
  tenantId: string;
  invoiceId: string;
  amountMinor: bigint;
  currency: string;
  paypalOrderId: string;
  idempotencyKey: string;
  checkoutUrl: string;
  providerResponse: Record<string, unknown>;
}

export interface CreatePayPalOrderResult {
  order: PayPalOrder;
  created: boolean;
}

/**
 * Acceso a datos de `paypal_orders` en finance_db. Todas las consultas filtran
 * explícitamente por `tenantId`: el aislamiento multi-tenant no depende del
 * llamador (mismo criterio que `FinanceRepository`).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly database: FinanceDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Devuelve la orden existente para la clave de idempotencia del tenant. */
  async findOrderByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .select()
      .from(paypalOrders)
      .where(
        and(eq(paypalOrders.tenantId, tenantId), eq(paypalOrders.idempotencyKey, idempotencyKey)),
      )
      .limit(1);

    return order ?? null;
  }

  /**
   * Inserta idempotentemente la orden: si la clave ya existe (carrera entre
   * réplicas) devuelve la fila original sin llamar de nuevo al proveedor.
   */
  async createOrderIdempotent(record: CreatePayPalOrderRecord): Promise<CreatePayPalOrderResult> {
    const [inserted] = await this.db
      .insert(paypalOrders)
      .values({
        tenantId: record.tenantId,
        invoiceId: record.invoiceId,
        amountMinor: record.amountMinor,
        currency: record.currency,
        paypalOrderId: record.paypalOrderId,
        idempotencyKey: record.idempotencyKey,
        checkoutUrl: record.checkoutUrl,
        providerResponse: record.providerResponse,
      })
      .onConflictDoNothing({
        target: [paypalOrders.tenantId, paypalOrders.idempotencyKey],
      })
      .returning();

    if (inserted) {
      return { order: inserted, created: true };
    }

    const existing = await this.findOrderByIdempotencyKey(record.tenantId, record.idempotencyKey);
    if (!existing) {
      throw new Error('No se pudo resolver la orden idempotente');
    }

    return { order: existing, created: false };
  }

  /** Factura visible para el tenant; se resuelve antes de llamar al proveedor. */
  async findInvoiceById(tenantId: string, invoiceId: string): Promise<{ currency: string } | null> {
    const [invoice] = await this.db
      .select({ currency: invoices.currency })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1);

    return invoice ?? null;
  }
}

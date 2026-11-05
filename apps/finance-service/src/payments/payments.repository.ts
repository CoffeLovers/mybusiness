import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { FinanceDatabaseService } from '../database/database.service';
import {
  invoices,
  paypalOrders,
  paypalRefunds,
  paypalWebhookEvents,
  type Invoice,
  type PayPalOrder,
  type PayPalRefund,
  type PayPalWebhookEvent,
} from '../database/schema';
import { PayPalOrderStatus } from '@mybusiness/contracts';

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

  /** Orden interna del tenant; base de los endpoints capture/refund (SF3-09). */
  async findOrderById(tenantId: string, orderId: string): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .select()
      .from(paypalOrders)
      .where(and(eq(paypalOrders.tenantId, tenantId), eq(paypalOrders.id, orderId)))
      .limit(1);

    return order ?? null;
  }

  /** Orden por identificador del proveedor (webhooks, comparación global). */
  async findOrderByPaypalOrderId(paypalOrderId: string): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .select()
      .from(paypalOrders)
      .where(eq(paypalOrders.paypalOrderId, paypalOrderId))
      .limit(1);

    return order ?? null;
  }

  /**
   * Órdenes cuyo `custom_id` (idempotencyKey) coincide con el del recurso del
   * webhook. La clave aún no es única globalmente, se limita a dos para
   * detectar ambigüedad y no deducir el tenant equivocado (SF3-09).
   */
  async findOrdersByIdempotencyKey(idempotencyKey: string): Promise<PayPalOrder[]> {
    return this.db
      .select()
      .from(paypalOrders)
      .where(eq(paypalOrders.idempotencyKey, idempotencyKey))
      .limit(2);
  }

  /** Órdenes respaldadas por una factura; desempate de webhooks sin custom_id. */
  async findOrdersByInvoiceId(invoiceId: string): Promise<PayPalOrder[]> {
    return this.db
      .select()
      .from(paypalOrders)
      .where(eq(paypalOrders.invoiceId, invoiceId))
      .limit(2);
  }

  /**
   * Transición de captura con reclamación optimista: actualiza sólo si la
   * orden aún está en alguno de los estados de origen, de modo que la capa de
   * servicio puede distinguir 409 (transición inválida) de carrera ganada por
   * otra réplica o por el webhook (reentrada idempotente, SF3-09).
   */
  async markOrderCaptured(record: {
    orderId: string;
    fromStatuses: readonly PayPalOrderStatus[];
    captureId: string;
    capturedAmountMinor: bigint;
  }): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .update(paypalOrders)
      .set({
        status: PayPalOrderStatus.CAPTURED,
        captureId: record.captureId,
        capturedAmountMinor: record.capturedAmountMinor,
        capturedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paypalOrders.id, record.orderId),
          inArray(paypalOrders.status, record.fromStatuses as PayPalOrderStatus[]),
        ),
      )
      .returning();

    return order ?? null;
  }

  /** Marca la orden APPROVED (webhook `CHECKOUT.ORDER.APPROVED`, SF3-09). */
  async markOrderApproved(record: {
    orderId: string;
    fromStatuses: readonly PayPalOrderStatus[];
  }): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .update(paypalOrders)
      .set({ status: PayPalOrderStatus.APPROVED, updatedAt: new Date() })
      .where(
        and(
          eq(paypalOrders.id, record.orderId),
          inArray(paypalOrders.status, record.fromStatuses as PayPalOrderStatus[]),
        ),
      )
      .returning();

    return order ?? null;
  }

  /**
   * Conciliación con la factura: pasa a PAID sólo si sigue en DRAFT/ISSUED/
   * OVERDUE, igual que `FinanceRepository.markInvoicePaid`; es idempotente y
   * no toca facturas canceladas (ADR ledger, SF3-09).
   */
  async markInvoicePaid(tenantId: string, invoiceId: string): Promise<Invoice | null> {
    const [invoice] = await this.db
      .update(invoices)
      .set({ status: 'PAID', updatedAt: new Date() })
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.id, invoiceId),
          inArray(invoices.status, ['DRAFT', 'ISSUED', 'OVERDUE']),
        ),
      )
      .returning();

    return invoice ?? null;
  }

  /** Reembolso por identificador del proveedor; deduplica reentradas webhook. */
  async findRefundByPaypalRefundId(paypalRefundId: string): Promise<PayPalRefund | null> {
    const [refund] = await this.db
      .select()
      .from(paypalRefunds)
      .where(eq(paypalRefunds.paypalRefundId, paypalRefundId))
      .limit(1);

    return refund ?? null;
  }

  /**
   * Inserta el reembolso; si el `paypal_refund_id` ya existe (un webhook
   * concurrente lo registró) devuelve la fila original sin
   * duplicar (`created=`false`).
   */
  async createRefund(record: {
    tenantId: string;
    orderId: string;
    captureId: string;
    paypalRefundId: string;
    amountMinor: bigint;
    currency: string;
    reason: string;
    requestedBy: string;
    providerStatus: string;
  }): Promise<{ refund: PayPalRefund; created: boolean }> {
    const [inserted] = await this.db
      .insert(paypalRefunds)
      .values(record)
      .onConflictDoNothing({ target: paypalRefunds.paypalRefundId })
      .returning();

    if (inserted) {
      return { refund: inserted, created: true };
    }

    const existing = await this.findRefundByPaypalRefundId(record.paypalRefundId);
    if (!existing) {
      throw new Error('No se pudo resolver el reembolso idempotente');
    }
    return { refund: existing, created: false };
  }

  /**
   * Acumula el importe reembolsado y promociona a REFUNDED cuando el total
   * capturado quedó cubierto. Protegido por `status = CAPTURED` como estados
   * de origen; si otra réplica ya promovió a REFUNDED devuelve 0 filas y el
   * servicio relee para decidir (SF3-09).
   */
  async applyRefundToOrder(record: {
    orderId: string;
    refundedAmountMinor: bigint;
    finalStatus: PayPalOrderStatus;
  }): Promise<PayPalOrder | null> {
    const [order] = await this.db
      .update(paypalOrders)
      .set({
        refundedAmountMinor: record.refundedAmountMinor,
        status: record.finalStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paypalOrders.id, record.orderId),
          eq(paypalOrders.status, PayPalOrderStatus.CAPTURED),
        ),
      )
      .returning();

    return order ?? null;
  }

  // ─── Webhooks PayPal (SF3-09) ────────────────────────────────────────────

  /** Evento por identificador del proveedor, base de la deduplicación. */
  async findWebhookEventByEventId(eventId: string): Promise<PayPalWebhookEvent | null> {
    const [event] = await this.db
      .select()
      .from(paypalWebhookEvents)
      .where(eq(paypalWebhookEvents.eventId, eventId))
      .limit(1);

    return event ?? null;
  }

  /**
   * Reserva atómica del evento sobre UNIQUE(event_id): INSERT con
   * `ON CONFLICT DO UPDATE` cuya `setWhere` sólo repone el evento cuando el
   * intento previo quedó FAILED (redelivery del proveedor → se reprocesa).
   * Conflictos con RECEIVED/PROCESSED/IGNORED no actualizan y devuelven null
   * (`already_processed`, reentrada en curso o ya resuelta).
   *
   * Garantía de carrera entre réplicas: PostgreSQL serializa los INSERT ..
   * ON CONFLICT DO UPDATE contra el mismo índice único y reevalúa `setWhere`
   * sobre la versión comprometida de la fila, de modo que sólo UNA réplica
   * obtiene el reset; no hay ventana SELECT-UPDATE ni doble reproceso.
   */
  async createWebhookEvent(record: {
    eventId: string;
    eventType: string;
    resourceId?: string;
    orderId?: string;
    payload: Record<string, unknown>;
  }): Promise<PayPalWebhookEvent | null> {
    const [event] = await this.db
      .insert(paypalWebhookEvents)
      .values({
        eventId: record.eventId,
        eventType: record.eventType,
        resourceId: record.resourceId ?? null,
        order: record.orderId ?? null,
        payload: record.payload,
        processingStatus: PayPalWebhookProcessEventStatus.RECEIVED,
      })
      .onConflictDoUpdate({
        target: paypalWebhookEvents.eventId,
        // Reset para reproceso: sólo si el intento anterior falló.
        set: {
          processingStatus: PayPalWebhookProcessEventStatus.RECEIVED,
          errorMessage: null,
          processedAt: null,
        },
        setWhere: eq(paypalWebhookEvents.processingStatus, PayPalWebhookProcessEventStatus.FAILED),
      })
      .returning();

    return event ?? null;
  }

  async markWebhookEvent(
    eventId: string,
    status: PayPalWebhookProcessEventStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.db
      .update(paypalWebhookEvents)
      .set({
        processingStatus: status,
        errorMessage: errorMessage ?? null,
        processedAt: new Date(),
      })
      .where(eq(paypalWebhookEvents.eventId, eventId));
  }
}

/** Estados internos de procesado de un webhook PayPal (tabla paypal_webhook_events). */
export const PayPalWebhookProcessEventStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
} as const;
export type PayPalWebhookProcessEventStatus =
  (typeof PayPalWebhookProcessEventStatus)[keyof typeof PayPalWebhookProcessEventStatus];

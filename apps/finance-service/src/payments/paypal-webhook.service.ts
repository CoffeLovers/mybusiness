import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PayPalOrderStatus, type PayPalWebhookResult } from '@mybusiness/contracts';
import { payPalDecimalToMinor } from '@mybusiness/contracts';
import { PayPalClient } from './paypal-client';
import { isPayPalTransitionAllowed } from './paypal-state-machine';
import { PayPalWebhookProcessEventStatus, PaymentsRepository } from './payments.repository';
import { PayPalPaymentService } from './paypal-payment.service';

/** Tipos de evento PayPal soportados; los demás se registran como IGNORED. */
const EVENT_CHECKOUT_ORDER_APPROVED = 'CHECKOUT.ORDER.APPROVED';
const EVENT_PAYMENT_CAPTURE_COMPLETED = 'PAYMENT.CAPTURE.COMPLETED';
const EVENT_PAYMENT_CAPTURE_REFUNDED = 'PAYMENT.CAPTURE.REFUNDED';

/**
 * Ingesta de webhooks PayPal (SF3-09). Verifica firma fail-closed contra el
 * API del proveedor (como el webhook bancario de #47), deduplica por
 * UNIQUE(event_id) — un duplicado responde `already_processed` sin
 * reprocesar — y mapea los eventos a las reconciliaciones de captura/reembolso
 * de `PayPalPaymentService`. La verificación fallida lanza 401 sin escribir
 * nada en la base de datos.
 */
@Injectable()
export class PayPalWebhookService {
  private readonly logger = new Logger(PayPalWebhookService.name);

  constructor(
    private readonly repository: PaymentsRepository,
    private readonly paypalClient: PayPalClient,
    private readonly paymentService: PayPalPaymentService,
  ) {}

  async handleWebhook(
    payload: Record<string, unknown> | undefined,
    headers: Record<string, string> | undefined,
    rawBody: string | undefined,
  ): Promise<PayPalWebhookResult> {
    // 1. Verificación de firma (fail-closed): sin mutating antes de este paso.
    const verification = await this.paypalClient.verifyWebhookSignature(
      rawBody ?? JSON.stringify(payload ?? {}),
      headers ?? {},
    );
    if (!verification.verified) {
      this.logger.warn(
        `Webhook PayPal rechazado por firma (motivo: ${verification.reason ?? 'desconocido'})`,
      );
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Firma de webhook de PayPal inválida o ausente.',
        error: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
      });
    }

    if (!payload) {
      throw this.invalidEvent('El cuerpo del webhook no es un objeto válido.');
    }

    const eventId = typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : null;
    const eventType =
      typeof payload.event_type === 'string' && payload.event_type.length > 0
        ? payload.event_type
        : null;
    if (!eventId || !eventType) {
      throw this.invalidEvent('El evento no contiene id o event_type válidos.');
    }

    // 2. Deduplicación por event_id: duplicado → 200 sin reprocesar.
    const existing = await this.repository.findWebhookEventByEventId(eventId);
    if (existing && existing.processingStatus !== PayPalWebhookProcessEventStatus.FAILED) {
      this.logger.log(`Webhook PayPal duplicado ignorado: ${eventType} (${eventId})`);
      return { status: 'already_processed', eventId };
    }

    // 3. Reserva idempotente del evento (carrera entre réplicas).
    const resource = this.resourceOf(payload);
    const inserted = await this.repository.createWebhookEvent({
      eventId,
      eventType,
      resourceId: this.resourceIdOf(resource),
      payload,
    });
    if (!inserted) {
      return { status: 'already_processed', eventId };
    }

    try {
      const outcome = await this.process(eventId, eventType, resource);
      await this.repository.markWebhookEvent(
        eventId,
        outcome.status === 'processed'
          ? PayPalWebhookProcessEventStatus.PROCESSED
          : PayPalWebhookProcessEventStatus.IGNORED,
        outcome.reason,
      );
      return {
        status: outcome.status,
        eventId,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al procesar webhook PayPal';
      await this.repository.markWebhookEvent(
        eventId,
        PayPalWebhookProcessEventStatus.FAILED,
        message.slice(0, 500),
      );
      throw error;
    }
  }

  private async process(
    eventId: string,
    eventType: string,
    resource: Record<string, unknown> | null,
  ): Promise<{ status: 'processed' | 'ignored'; reason?: string }> {
    switch (eventType) {
      case EVENT_CHECKOUT_ORDER_APPROVED:
        return this.processOrderApproved(resource);
      case EVENT_PAYMENT_CAPTURE_COMPLETED:
        return this.processCaptureCompleted(resource);
      case EVENT_PAYMENT_CAPTURE_REFUNDED:
        return this.processCaptureRefunded(resource);
      default:
        return { status: 'ignored', reason: 'evento_no_accionable' };
    }
  }

  /** El pagador aprobó: CREATED → APPROVED (webhook autoritativo del proveedor). */
  private async processOrderApproved(
    resource: Record<string, unknown> | null,
  ): Promise<{ status: 'processed' | 'ignored'; reason?: string }> {
    const paypalOrderId = resource && typeof resource.id === 'string' ? resource.id : null;
    const order = paypalOrderId
      ? await this.repository.findOrderByPaypalOrderId(paypalOrderId)
      : null;

    if (!order) {
      return { status: 'ignored', reason: 'orden_no_resuelta' };
    }
    if (order.status === PayPalOrderStatus.APPROVED) {
      return { status: 'processed' }; // Reentrada idempotente.
    }
    if (!isPayPalTransitionAllowed(order.status as PayPalOrderStatus, PayPalOrderStatus.APPROVED)) {
      return { status: 'ignored', reason: 'transicion_invalida' };
    }

    await this.repository.markOrderApproved({
      orderId: order.id,
      fromStatuses: [PayPalOrderStatus.CREATED],
    });
    this.logger.log(`Orden ${order.id} marcada APPROVED por webhook.`);
    return { status: 'processed' };
  }

  /** Fondos capturados: conciliación local idempotente por estado. */
  private async processCaptureCompleted(
    resource: Record<string, unknown> | null,
  ): Promise<{ status: 'processed' | 'ignored'; reason?: string }> {
    const captureId = resource && typeof resource.id === 'string' ? resource.id : null;
    const order = await this.resolveOrderByResource(resource);
    if (!order || !captureId) {
      return { status: 'ignored', reason: 'orden_no_resuelta' };
    }
    if (
      order.status === PayPalOrderStatus.CAPTURED ||
      order.status === PayPalOrderStatus.REFUNDED
    ) {
      return { status: 'processed' }; // Ya conciliada: reentrada idempotente.
    }

    const amountMinor = resource ? this.amountMinorOf(resource) : 0n;
    await this.paymentService.reconcileCapture(order, captureId, amountMinor);
    return { status: 'processed' };
  }

  /** Fondos devueltos: reutiliza la acumulación y auditoría del endpoint. */
  private async processCaptureRefunded(
    resource: Record<string, unknown> | null,
  ): Promise<{ status: 'processed' | 'ignored'; reason?: string }> {
    const paypalRefundId = resource && typeof resource.id === 'string' ? resource.id : null;
    const order = await this.resolveOrderByResource(resource);
    if (!order || !paypalRefundId) {
      return { status: 'ignored', reason: 'orden_no_resuelta' };
    }

    const captureRefundId =
      resource && typeof resource.capture_id === 'string' ? resource.capture_id : undefined;
    // Idempotencia real: si el endpoint ya registró este REFUND-id, no rehacer nada.
    const known = await this.repository.findRefundByPaypalRefundId(paypalRefundId);
    if (known) {
      return { status: 'processed' };
    }
    if (order.status !== PayPalOrderStatus.CAPTURED || (!order.captureId && !captureRefundId)) {
      return { status: 'ignored', reason: 'transicion_invalida' };
    }

    await this.paymentService.reconcileRefund(
      order,
      captureRefundId ?? order.captureId ?? '',
      paypalRefundId,
      this.amountMinorOf(resource ?? {}),
    );
    return { status: 'processed' };
  }

  /**
   * Resolución de la orden interna a partir del recurso del proveedor, sin
   * depender de un solo campo: sigue el `custom_id` (idempotencyKey de la
   * orden, SF3-08) y hace fallback por el `invoice_id` de la purchase unit.
   * Con ambigüedad (dos órdenes) se ignora el webhook en lugar de adivinar.
   */
  private async resolveOrderByResource(resource: Record<string, unknown> | null): Promise<{
    id: string;
    tenantId: string;
    invoiceId: string;
    paypalOrderId: string;
    captureId: string | null;
    amountMinor: bigint;
    capturedAmountMinor: bigint | null;
    refundedAmountMinor: bigint | null;
    status: string;
    currency: string;
  } | null> {
    if (!resource) {
      return null;
    }

    if (typeof resource.custom_id === 'string' && resource.custom_id.length > 0) {
      const matches = await this.repository.findOrdersByIdempotencyKey(resource.custom_id);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        this.logger.warn('Webhook con custom_id ambiguo entre tenants; se ignora.');
        return null;
      }
    }

    const invoiceId = this.invoiceIdOf(resource);
    if (invoiceId) {
      const matches = await this.repository.findOrdersByInvoiceId(invoiceId);
      if (matches.length === 1) {
        return matches[0];
      }
    }

    return null;
  }

  private resourceOf(payload: Record<string, unknown>): Record<string, unknown> | null {
    const resource = payload.resource;
    if (resource && typeof resource === 'object' && !Array.isArray(resource)) {
      return resource as Record<string, unknown>;
    }
    return null;
  }

  private resourceIdOf(resource: Record<string, unknown> | null): string | undefined {
    const id = resource && typeof resource.id === 'string' ? resource.id : undefined;
    return id && id.length <= 255 ? id : undefined;
  }

  private invoiceIdOf(resource: Record<string, unknown>): string | null {
    if (typeof resource.invoice_id === 'string' && resource.invoice_id.length > 0) {
      return resource.invoice_id;
    }
    const units = resource.purchase_units;
    if (Array.isArray(units) && units.length > 0) {
      const unit = units[0];
      if (unit && typeof unit === 'object' && !Array.isArray(unit)) {
        const invoice = (unit as Record<string, unknown>).invoice_id;
        if (typeof invoice === 'string' && invoice.length > 0) {
          return invoice;
        }
      }
    }
    return null;
  }

  /** Importe del recurso decimal → unidad mínima (ADR 003); 0 si no es legible. */
  private amountMinorOf(resource: Record<string, unknown>): bigint {
    const amount = resource.amount;
    if (!amount || typeof amount !== 'object' || Array.isArray(amount)) {
      return 0n;
    }
    const record = amount as Record<string, unknown>;
    const value = typeof record.value === 'string' ? record.value : null;
    const currency = typeof record.currency_code === 'string' ? record.currency_code : null;
    if (!value || !currency) {
      return 0n;
    }
    try {
      return BigInt(payPalDecimalToMinor(value, currency));
    } catch {
      // Importe no normalizable (ADR 003): fallar hace que el evento quede FAILED
      // y el proveedor lo redeliveree; nunca se concilia con importes menguados.
      throw this.invalidEvent('El importe del evento no es un decimal válido.');
    }
  }

  private invalidEvent(message: string): BadRequestException {
    return new BadRequestException({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'PAYMENT_WEBHOOK_EVENT_INVALID',
    });
  }
}

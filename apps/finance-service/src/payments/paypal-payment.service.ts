import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  AuditEvents,
  PaymentEvents,
  PayPalOrderStatus,
  PAYMENT_AMOUNT_MINOR_PATTERN,
  type CapturePayPalOrderDto,
  type PayPalOrderView,
  type PayPalRefundView,
  type RefundPayPalOrderDto,
  type RequestContext,
} from '@mybusiness/contracts';
import { DomainEventPublisher } from '../events/domain-event.publisher';
import { PayPalClient } from './paypal-client';
import { PayPalTransitionError, requirePayPalTransition } from './paypal-state-machine';
import { PaymentsRepository } from './payments.repository';
import {
  mapPayPalErrorToHttpException,
  paymentHttpException,
  paymentOrderNotFound,
  toPayPalOrderView,
  toPayPalRefundView,
} from './paypal-support';
import { runWithPaypalBackoff, type PayPalBackoffOptions } from './paypal-retry';

/** Actor de auditoría que solo puede atribuirse al webhook del proveedor. */
export const WEBHOOK_ACTOR = 'system:paypal-webhook';
/** Motivo por defecto de reembolsos notificados (y no solicitados) vía webhook. */
export const WEBHOOK_REFUND_REASON = 'Notificación del proveedor';

/**
 * Orquestador de capturas y reembolsos PayPal (SF3-09). Aplica la máquina de
 * estados declarada en `paypal-state-machine.ts`, transita la orden con
 * UPDATE condicionales (las carreras con el webhook terminan en reentrada
 * idempotente), concilia la factura con el libro mayor y registra auditoría
 * con motivo y actor (ADR 003). Los fallos transitorios del proveedor se
 * reintentan con backoff exponencial con jitter (`paypal-retry.ts`); al
 * agotarse, la orden queda en un estado visible sin mutar (APPROVED para
 * capturas, CAPTURED para reembolsos).
 */
@Injectable()
export class PayPalPaymentService {
  private readonly logger = new Logger(PayPalPaymentService.name);

  constructor(
    private readonly repository: PaymentsRepository,
    private readonly paypalClient: PayPalClient,
    private readonly events: DomainEventPublisher,
    private readonly config: ConfigService,
  ) {}

  private get backoffOptions(): Partial<PayPalBackoffOptions> {
    const attempts = Number(this.config.get<string | number>('PAYPAL_RETRY_MAX_ATTEMPTS'));
    const baseDelay = Number(this.config.get<string | number>('PAYPAL_RETRY_BASE_DELAY_MS'));
    return {
      ...(Number.isInteger(attempts) && attempts > 0 ? { maxAttempts: attempts } : {}),
      ...(Number.isFinite(baseDelay) && baseDelay > 0 ? { baseDelayMs: baseDelay } : {}),
    };
  }

  /**
   * Captura total (o parcial) de una orden aprobada. Con importe menor al
   * total, PayPal ejecuta la captura TOTAL (la API no admite capturas
   * parciales de órdenes) y el importe parcial queda registrado localmente en
   * `captured_amount_minor`, decisión documentada en
   * `PayPalClient.captureOrder` (SF3-09).
   */
  async capture(
    ctx: RequestContext,
    orderId: string,
    dto: CapturePayPalOrderDto,
  ): Promise<PayPalOrderView> {
    const tenantId = requireTenantId(ctx);
    const order = await this.repository.findOrderById(tenantId, orderId);
    if (!order) {
      throw paymentOrderNotFound();
    }

    try {
      requirePayPalTransition(order.status as PayPalOrderStatus, PayPalOrderStatus.CAPTURED);
    } catch (error) {
      throw this.invalidTransitionOrRethrow(error);
    }

    const requestedMinor = dto.amountMinor
      ? this.validatePartialAmount(dto.amountMinor, order.amountMinor, 'a capturar')
      : order.amountMinor;

    let capture;
    try {
      capture = await runWithPaypalBackoff(
        () => this.paypalClient.captureOrder(order.paypalOrderId, order.idempotencyKey),
        this.backoffOptions,
      );
    } catch (error) {
      // Estado visible: la orden permanece CREATED/APPROVED ante un fallo del proveedor.
      throw mapPayPalErrorToHttpException(error, this.logger, 'la captura');
    }

    if (!capture.captureId) {
      throw paymentHttpException(
        HttpStatus.BAD_GATEWAY,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'El proveedor de pagos no devolvió identificador de captura.',
      );
    }
    const captureId: string = capture.captureId;

    const claimed = await this.repository.markOrderCaptured({
      orderId: order.id,
      fromStatuses: [PayPalOrderStatus.CREATED, PayPalOrderStatus.APPROVED],
      captureId,
      capturedAmountMinor: requestedMinor,
    });

    if (!claimed) {
      const current = await this.repository.findOrderById(tenantId, orderId);
      if (current && current.status === PayPalOrderStatus.CAPTURED) {
        // Carrera: el webhook u otra réplica ya registró la captura.
        return toPayPalOrderView(current);
      }
      throw this.invalidTransition(
        new PayPalTransitionError(
          (current?.status ?? order.status) as PayPalOrderStatus,
          PayPalOrderStatus.CAPTURED,
        ),
      );
    }

    await this.reconcileInvoice(tenantId, order.invoiceId, 'la captura');
    await this.publishCapturedEvents({
      tenantId,
      actor: ctx.userId,
      role: ctx.role,
      orderId: order.id,
      invoiceId: order.invoiceId,
      paypalOrderId: order.paypalOrderId,
      captureId,
      amountMinor: requestedMinor,
      currency: order.currency,
    });

    return toPayPalOrderView(claimed);
  }

  /**
   * Reembolso (total o parcial) con motivo obligatorio y auditoría. Cuando el
   * importe acumulado cubre la captura, la orden transita a REFUNDED (mapa
   * central de estados). Fallos del proveedor no mutan la orden (visible en
   * CAPTURED) y los códigos PAYMENT_* quedan estables.
   *
   * Nota de operación: no existe soporte para un segundo reembolso del MISMO
   * importe sobre una misma captura — el PayPal-Request-Id es determinista
   * por (orden, captura, importe) y PayPal deduplica la petición repetida
   * (ver el comentario en la derivación de la clave más abajo). Ante ese
   * escenario, reembolsar por un importe distinto al ya devuelto o tramitar
   * el movimiento manualmente en el panel de PayPal.
   */
  async refund(
    ctx: RequestContext,
    orderId: string,
    dto: RefundPayPalOrderDto,
  ): Promise<PayPalRefundView> {
    const tenantId = requireTenantId(ctx);
    if (typeof dto.reason !== 'string' || dto.reason.trim().length === 0) {
      throw new BadRequestException('El motivo del reembolso es obligatorio.');
    }

    const order = await this.repository.findOrderById(tenantId, orderId);
    if (!order) {
      throw paymentOrderNotFound();
    }
    if (!order.captureId) {
      // Reembolsar una orden sin captura confirmada: transición inválida (409).
      throw this.invalidTransition(
        new PayPalTransitionError(order.status as PayPalOrderStatus, PayPalOrderStatus.REFUNDED),
      );
    }
    const captureId: string = order.captureId;

    const capturedMinor = order.capturedAmountMinor ?? order.amountMinor;
    const refundedMinor = order.refundedAmountMinor ?? 0n;
    const remainingMinor = capturedMinor - refundedMinor;
    if (remainingMinor <= 0n) {
      throw this.invalidTransition(
        new PayPalTransitionError(order.status as PayPalOrderStatus, PayPalOrderStatus.REFUNDED),
      );
    }

    const requestedMinor = dto.amountMinor
      ? this.validatePartialAmount(dto.amountMinor, remainingMinor, 'a reembolsar')
      : remainingMinor;

    // Clave determinista del proveedor (PayPal-Request-Id): incluso si un
    // reintento tras timeout reenvía la petición, el proveedor no duplica la
    // devolución. Los reembolsos parciales con importe distinto obtienen
    // claves distintas (ver decisión, ADR 003 §4).
    //
    // LÍMITE CONOCIDO: PayPal deduplica por PayPal-Request-Id, así que un
    // segundo reembolso legítimo del MISMO importe sobre la misma captura
    // reutiliza esta clave y el proveedor no ejecuta una nueva devolución
    // (devolverá el primer refund). En ese caso el operador debe: registrar
    // el reembolso con un importe distinto (el restante, que produce otra
    // clave) o tramitarlo manualmente en el panel del proveedor y
    // conciliarlo. No se secuencia la clave por diseño (mínima reparación
    // SF3-09/QA); el secuenciador queda fuera de alcance.
    const requestId = `${order.idempotencyKey}:refund:${captureId}:${requestedMinor.toString()}`;
    let refund;
    try {
      refund = await runWithPaypalBackoff(
        () =>
          this.paypalClient.refundCapture({
            captureId,
            amountMinor: requestedMinor === capturedMinor ? undefined : requestedMinor.toString(),
            currency: order.currency,
            reason: dto.reason,
            requestId,
          }),
        this.backoffOptions,
      );
    } catch (error) {
      // Estado visible: la orden permanece CAPTURED ante un fallo del proveedor.
      throw mapPayPalErrorToHttpException(error, this.logger, 'el reembolso');
    }

    const stored = await this.repository.createRefund({
      tenantId,
      orderId: order.id,
      captureId,
      paypalRefundId: refund.refundId,
      amountMinor: requestedMinor,
      currency: order.currency,
      reason: dto.reason,
      requestedBy: ctx.userId || 'unknown',
      providerStatus: refund.status,
    });

    if (!stored.created) {
      // Reentrada idempotente: el webhook u otra réplica ya registró el reembolso.
      return toPayPalRefundView(stored.refund);
    }

    await this.advanceRefundState(tenantId, order.id, {
      refundedMinor: refundedMinor + requestedMinor,
      capturedMinor,
    });

    await this.publishRefundEvents(tenantId, ctx.userId, ctx.role, order.id, {
      refundId: refund.refundId,
      amountMinor: requestedMinor,
      currency: order.currency,
      reason: dto.reason,
      requestedBy: stored.refund.requestedBy,
    });

    return toPayPalRefundView(stored.refund);
  }

  /**
   * Reconciliación del webhook `PAYMENT.CAPTURE.COMPLETED` (SF3-09): el
   * proveedor ya capturó, así que se marca CAPTURED localmente con el importe
   * notificado (clamp al total de la orden) sin llamar al proveedor, se
   * concilia la factura y se publican los eventos. Reentrant por estado:
   * si ya está CAPTURED/REFUNDED no republish nada.
   */
  async reconcileCapture(
    paypalOrder: {
      id: string;
      tenantId: string;
      invoiceId: string;
      paypalOrderId: string;
      currency: string;
      amountMinor: bigint;
    },
    captureId: string,
    providerAmountMinor: bigint,
  ): Promise<void> {
    const clampedAmountMinor =
      providerAmountMinor > paypalOrder.amountMinor ? paypalOrder.amountMinor : providerAmountMinor;

    // Divergencia de importe contra la orden: no se bloquea (el proveedor
    // confirmó fondos), pero la conciliación queda aclarada con el clamp y
    // la divergencia queda auditable (criterio QA H2).
    if (providerAmountMinor > paypalOrder.amountMinor) {
      this.logger.warn(
        `Divergencia en la captura ${captureId} de la orden ${paypalOrder.id}: el proveedor notificó ${providerAmountMinor} minor y la orden declara ${paypalOrder.amountMinor} minor; se concilia con el importe de la orden (clamp, ADR 003).`,
      );
      await this.events.publish(AuditEvents.LOG_EVENT, {
        eventId: randomUUID(),
        tenantId: paypalOrder.tenantId,
        userId: WEBHOOK_ACTOR,
        role: undefined,
        action: PaymentEvents.PAYPAL_CAPTURED,
        entityName: 'paypal_orders',
        entityId: paypalOrder.id,
        newValues: {
          captureId,
          providerAmountMinor: providerAmountMinor.toString(),
          orderAmountMinor: paypalOrder.amountMinor.toString(),
          reconciledAmountMinor: clampedAmountMinor.toString(),
          divergence: 'provider_amount_exceeds_order_amount',
          currency: paypalOrder.currency,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const claimed = await this.repository.markOrderCaptured({
      orderId: paypalOrder.id,
      fromStatuses: [PayPalOrderStatus.CREATED, PayPalOrderStatus.APPROVED],
      captureId,
      capturedAmountMinor: clampedAmountMinor,
    });

    if (!claimed) {
      return; // Ya CAPTURED/REFUNDED (reentrada del proveedor): sin duplicar eventos.
    }

    this.logger.log(`Orden ${paypalOrder.id} conciliada como CAPTURED vía webhook.`);
    await this.reconcileInvoice(paypalOrder.tenantId, paypalOrder.invoiceId, 'la captura');
    await this.publishCapturedEvents({
      tenantId: paypalOrder.tenantId,
      actor: WEBHOOK_ACTOR,
      role: undefined,
      orderId: paypalOrder.id,
      invoiceId: paypalOrder.invoiceId,
      paypalOrderId: paypalOrder.paypalOrderId,
      captureId,
      amountMinor: clampedAmountMinor,
      currency: paypalOrder.currency,
    });
  }

  /**
   * Reconciliación del webhook `PAYMENT.CAPTURE.REFUNDED` (SF3-09): registra el
   * reembolso notificado por el proveedor con motivo genérico y actor del
   * webhook, acumula y promociona a REFUNDED si cubre la captura. Idempotente
   * por `paypal_refund_id`: si ya fue registrado por el endpoint, no republish.
   */
  async reconcileRefund(
    paypalOrder: {
      id: string;
      tenantId: string;
      captureId: string | null;
      amountMinor: bigint;
      capturedAmountMinor: bigint | null;
      refundedAmountMinor: bigint | null;
      currency: string;
    },
    captureId: string,
    paypalRefundId: string,
    refundedAmountMinor: bigint,
  ): Promise<void> {
    const effectiveCaptureId = paypalOrder.captureId ?? captureId;
    if (!effectiveCaptureId) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'El webhook de reembolso no corresponde a una orden capturada.',
        error: 'PAYMENT_INVALID_TRANSITION',
      });
    }

    const stored = await this.repository.createRefund({
      tenantId: paypalOrder.tenantId,
      orderId: paypalOrder.id,
      captureId: effectiveCaptureId,
      paypalRefundId,
      amountMinor: refundedAmountMinor,
      currency: paypalOrder.currency,
      reason: WEBHOOK_REFUND_REASON,
      requestedBy: WEBHOOK_ACTOR,
      providerStatus: 'COMPLETED',
    });

    if (!stored.created) {
      return; // Ya registrado por el endpoint (mismo REFUND-id): no duplicar.
    }

    const capturedMinor = paypalOrder.capturedAmountMinor ?? paypalOrder.amountMinor;
    const refundedMinor = (paypalOrder.refundedAmountMinor ?? 0n) + refundedAmountMinor;
    await this.advanceRefundState(paypalOrder.tenantId, paypalOrder.id, {
      refundedMinor,
      capturedMinor,
    });

    await this.publishRefundEvents(paypalOrder.tenantId, WEBHOOK_ACTOR, undefined, paypalOrder.id, {
      refundId: paypalRefundId,
      amountMinor: refundedAmountMinor,
      currency: paypalOrder.currency,
      reason: WEBHOOK_REFUND_REASON,
      requestedBy: WEBHOOK_ACTOR,
    });
  }

  /**
   * Promociona a REFUNDED cuando el acumulado cubre la captura; si otra réplica
   * o el webhook ya movió la orden, relee y regoistra la divergencia en el log.
   */
  private async advanceRefundState(
    tenantId: string,
    orderId: string,
    amounts: { refundedMinor: bigint; capturedMinor: bigint },
  ): Promise<void> {
    const finalStatus =
      amounts.refundedMinor >= amounts.capturedMinor
        ? PayPalOrderStatus.REFUNDED
        : PayPalOrderStatus.CAPTURED;

    const applied = await this.repository.applyRefundToOrder({
      orderId,
      refundedAmountMinor: amounts.refundedMinor,
      finalStatus,
    });

    if (!applied) {
      const current = await this.repository.findOrderById(tenantId, orderId);
      if (current?.status === PayPalOrderStatus.REFUNDED) {
        return; // Otro proceso ya completó el ciclo REFUNDED.
      }
      this.logger.warn(
        `No se pudo acumular el reembolso de la orden ${orderId} (estado ${current?.status ?? 'desconocido'}).`,
      );
    }
  }

  private async reconcileInvoice(
    tenantId: string,
    invoiceId: string,
    context: string,
  ): Promise<void> {
    const updated = await this.repository.markInvoicePaid(tenantId, invoiceId);
    if (!updated) {
      this.logger.log(
        `La factura ${invoiceId} no requirió conciliación tras ${context} (ya PAID o CANCELLED).`,
      );
    }
  }

  private async publishCapturedEvents(detail: {
    tenantId: string;
    actor: string | undefined;
    role: RequestContext['role'] | undefined;
    orderId: string;
    invoiceId: string;
    paypalOrderId: string;
    captureId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<void> {
    const timestamp = new Date().toISOString();

    // Evento de dominio (consumidores de integración, ADR 002).
    await this.events.publish(PaymentEvents.PAYPAL_CAPTURED, {
      eventId: randomUUID(),
      tenantId: detail.tenantId,
      userId: detail.actor ?? WEBHOOK_ACTOR,
      invoiceId: detail.invoiceId,
      paypalOrderId: detail.paypalOrderId,
      captureId: detail.captureId,
      amountMinor: detail.amountMinor.toString(),
      currency: detail.currency,
      occurredAt: timestamp,
    });

    // Auditoría best-effort: actor, importe y factura (criterio del issue).
    await this.events.publish(AuditEvents.LOG_EVENT, {
      eventId: randomUUID(),
      tenantId: detail.tenantId,
      userId: detail.actor ?? WEBHOOK_ACTOR,
      role: detail.role,
      action: PaymentEvents.PAYPAL_CAPTURED,
      entityName: 'paypal_orders',
      entityId: detail.orderId,
      newValues: {
        captureId: detail.captureId,
        amountMinor: detail.amountMinor.toString(),
        currency: detail.currency,
        invoiceId: detail.invoiceId,
      },
      timestamp,
    });
  }

  private async publishRefundEvents(
    tenantId: string,
    userId: string | undefined,
    role: RequestContext['role'] | undefined,
    orderId: string,
    detail: {
      refundId: string;
      amountMinor: bigint;
      currency: string;
      reason: string;
      requestedBy: string;
    },
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    // Evento de dominio: motivo y actor visibles para consumidores (criterio del issue).
    await this.events.publish(PaymentEvents.PAYPAL_REFUNDED, {
      eventId: randomUUID(),
      tenantId,
      userId: userId ?? WEBHOOK_ACTOR,
      invoiceRef: orderId,
      refundId: detail.refundId,
      amountMinor: detail.amountMinor.toString(),
      currency: detail.currency,
      reason: detail.reason,
      requestedBy: detail.requestedBy,
      occurredAt: timestamp,
    });

    // Auditoría con motivo y actor desde cualquier superficie (endpoint o webhook).
    await this.events.publish(AuditEvents.LOG_EVENT, {
      eventId: randomUUID(),
      tenantId,
      userId: userId ?? WEBHOOK_ACTOR,
      role,
      action: PaymentEvents.PAYPAL_REFUNDED,
      entityName: 'paypal_orders',
      entityId: orderId,
      newValues: {
        refundId: detail.refundId,
        amountMinor: detail.amountMinor.toString(),
        currency: detail.currency,
        reason: detail.reason,
        requestedBy: detail.requestedBy,
      },
      timestamp,
    });
  }

  private validatePartialAmount(value: string, limitMinor: bigint, label: string): bigint {
    if (!PAYMENT_AMOUNT_MINOR_PATTERN.test(value)) {
      throw new BadRequestException(
        `El importe ${label} debe ser un entero positivo, sin decimales ni signo.`,
      );
    }
    const requested = BigInt(value);
    if (requested > limitMinor) {
      throw paymentHttpException(
        HttpStatus.BAD_REQUEST,
        'PAYMENT_INVALID_AMOUNT',
        `El importe ${label} excede el importe pendiente de la orden.`,
      );
    }
    return requested;
  }

  private invalidTransition(error: PayPalTransitionError): ConflictException {
    return new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      message: error.message,
      error: error.code,
    });
  }

  private invalidTransitionOrRethrow(error: unknown): ConflictException {
    if (error instanceof PayPalTransitionError) {
      return this.invalidTransition(error);
    }
    throw error;
  }
}

function requireTenantId(ctx: RequestContext): string {
  if (!ctx.tenantId) {
    throw new BadRequestException('tenantId es requerido en el contexto.');
  }
  return ctx.tenantId;
}

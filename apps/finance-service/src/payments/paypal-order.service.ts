import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditEvents,
  PayPalOrderStatus,
  PAYMENT_AMOUNT_MINOR_PATTERN,
  type CreatePayPalOrderDto,
  type PayPalOrderView,
  type RequestContext,
} from '@mybusiness/contracts';
import { DomainEventPublisher } from '../events/domain-event.publisher';
import { PayPalClient } from './paypal-client';
import { PaymentsRepository } from './payments.repository';
import { mapPayPalErrorToHttpException, toPayPalOrderView } from './paypal-support';

/**
 * Orquestador de órdenes PayPal (SF3-08). Valida el importe antes de salir del
 * proceso, garantiza la idempotencia por clave del cliente y persiste la orden
 * con la respuesta original del proveedor. Los estados posteriores a CREATED
 * (APPROVED/CAPTURED/...) se gestionan en SF3-09.
 */
@Injectable()
export class PayPalOrderService {
  private readonly logger = new Logger(PayPalOrderService.name);

  constructor(
    private readonly repository: PaymentsRepository,
    private readonly paypalClient: PayPalClient,
    private readonly events: DomainEventPublisher,
  ) {}

  async createOrder(ctx: RequestContext, dto: CreatePayPalOrderDto): Promise<PayPalOrderView> {
    const tenantId = this.requireTenant(ctx);

    this.validateAmount(dto);
    this.validateIdempotency(dto);

    const invoice = await this.repository.findInvoiceById(tenantId, dto.invoiceRef);
    if (!invoice) {
      throw new NotFoundException('La factura no existe para este tenant.');
    }

    if (invoice.currency !== dto.currency) {
      throw new BadRequestException('La moneda de la orden no coincide con la de la factura.');
    }

    // Replay idempotente: devolver la orden persistida sin tocar el proveedor.
    const existing = await this.repository.findOrderByIdempotencyKey(tenantId, dto.idempotencyKey);
    if (existing) {
      return this.toView(existing);
    }

    let created: Awaited<ReturnType<PayPalClient['createOrder']>>;
    try {
      created = await this.paypalClient.createOrder({
        amountMinor: dto.amountMinor,
        currency: dto.currency,
        description: dto.description,
        invoiceRef: dto.invoiceRef,
        idempotencyKey: dto.idempotencyKey,
      });
    } catch (error) {
      // Traduce los errores del cliente a códigos PAYMENT_* estables (SF3-08).
      throw mapPayPalErrorToHttpException(error, this.logger, 'la creación de la orden');
    }

    const checkoutUrl = created.links.find((link) => link.rel === 'approve')?.href;
    if (!checkoutUrl) {
      this.logger.warn('El proveedor no devolvió enlace de aprobación para una orden nueva.');
      throw new BadGatewayException('El proveedor de pagos no devolvió enlace de checkout.');
    }

    const result = await this.repository.createOrderIdempotent({
      tenantId,
      invoiceId: dto.invoiceRef,
      amountMinor: BigInt(dto.amountMinor),
      currency: dto.currency,
      paypalOrderId: created.id,
      idempotencyKey: dto.idempotencyKey,
      checkoutUrl,
      providerResponse: created.raw,
    });

    if (result.created) {
      // Auditoría de orden (factura, importe y actor) best-effort vía el bus
      // de eventos de finance; el publisher captura sus propios errores.
      await this.events.publish(AuditEvents.LOG_EVENT, {
        eventId: randomUUID(),
        tenantId,
        userId: ctx.userId,
        role: ctx.role,
        action: 'payments.paypal.order.created',
        entityName: 'paypal_order',
        entityId: result.order.id,
        newValues: {
          invoiceId: dto.invoiceRef,
          amountMinor: dto.amountMinor,
          currency: dto.currency,
          paypalOrderId: created.id,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return this.toView(result.order);
  }

  private validateAmount(dto: CreatePayPalOrderDto): void {
    if (!PAYMENT_AMOUNT_MINOR_PATTERN.test(dto.amountMinor)) {
      throw new BadRequestException(
        'amountMinor debe ser un entero positivo, sin decimales, cero ni signo.',
      );
    }
  }

  private validateIdempotency(dto: CreatePayPalOrderDto): void {
    if (typeof dto.idempotencyKey !== 'string' || dto.idempotencyKey.trim().length === 0) {
      throw new BadRequestException('La clave de idempotencia es obligatoria.');
    }
  }

  /** Vista pública: nunca incluye la respuesta cruda del proveedor. */
  private toView(order: {
    id: string;
    tenantId: string;
    invoiceId: string;
    paypalOrderId: string;
    status: string;
    amountMinor: bigint;
    currency: string;
    checkoutUrl: string;
    createdAt: Date;
  }): PayPalOrderView {
    return toPayPalOrderView(order);
  }

  private requireTenant(ctx: RequestContext): string {
    if (!ctx.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto.');
    }
    return ctx.tenantId;
  }
}

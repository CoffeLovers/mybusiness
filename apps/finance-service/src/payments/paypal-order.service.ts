import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
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
import { PayPalClient, PayPalClientError } from './paypal-client';
import { PaymentsRepository } from './payments.repository';

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
      throw this.toHttpException(error);
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

  /**
   * Traduce los errores tipados del cliente a códigos HTTP estables. Los
   * mensajes nunca revelan credenciales, tokens ni cuerpos del proveedor.
   */
  private toHttpException(error: unknown): HttpException {
    if (!(error instanceof PayPalClientError)) {
      this.logger.error(
        'Fallo inesperado creando la orden de pago',
        error instanceof Error ? error.name : undefined,
      );
      return new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'No se pudo crear la orden de pago',
          error: 'PAYMENT_ORDER_FAILED',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.warn(`Error del proveedor de pagos (código ${error.code})`);

    switch (error.code) {
      case 'PAYPAL_TIMEOUT':
        return new HttpException(
          {
            statusCode: HttpStatus.GATEWAY_TIMEOUT,
            message: 'El proveedor de pagos no respondió a tiempo',
            error: 'PAYMENT_PROVIDER_TIMEOUT',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      case 'PAYPAL_RATE_LIMITED':
        return new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'El proveedor de pagos alcanzó su límite de solicitudes',
            error: 'PAYMENT_PROVIDER_RATE_LIMITED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'PAYPAL_NOT_CONFIGURED':
        this.logger.error('Credenciales de PayPal ausentes en la configuración del servicio');
        break;
      default:
        break;
    }

    return new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'El proveedor de pagos rechazó la creación de la orden',
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
      },
      HttpStatus.BAD_GATEWAY,
    );
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
    return {
      id: order.id,
      tenantId: order.tenantId,
      invoiceRef: order.invoiceId,
      paypalOrderId: order.paypalOrderId,
      status: order.status as PayPalOrderStatus,
      amountMinor: order.amountMinor.toString(),
      currency: order.currency,
      checkoutUrl: order.checkoutUrl,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private requireTenant(ctx: RequestContext): string {
    if (!ctx.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto.');
    }
    return ctx.tenantId;
  }
}

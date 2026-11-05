import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { UserRole } from '../enums';
import { PayPalOrderStatus } from '../enums/payments.enum';
import { CURRENCY_CODE_PATTERN, MAX_MONEY_MINOR_DIGITS } from '../money';

/**
 * Importe entero estrictamente positivo (`> 0`) en la unidad mínima de la
 * moneda. Una orden de cobro no admite 0, negativos ni decimales (ADR 003).
 */
export const PAYMENT_AMOUNT_MINOR_PATTERN = /^[1-9]\d*$/;

/** Límite de PayPal para `purchase_units[].description` y `custom_id`. */
export const PAYPAL_DESCRIPTION_MAX_LENGTH = 127;

/**
 * Solicitud de creación de una orden PayPal asociada a una factura del libro
 * mayor. El importe viaja como entero en unidad mínima (centavos) o como string
 * entero sin signo; nunca como `number` flotante (ADR 003).
 */
export class CreatePayPalOrderDto {
  /** Entero decimal estrictamente positivo, p.ej. `"25000"` = 250,00. */
  @IsString()
  @Matches(PAYMENT_AMOUNT_MINOR_PATTERN, {
    message: 'amountMinor debe ser un entero positivo, sin decimales ni signo',
  })
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  amountMinor!: string;

  /** Código ISO 4217 de la moneda de la factura/orden. */
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  currency!: string;

  /** Descripción visible en PayPal (límite del proveedor: 127 caracteres). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAYPAL_DESCRIPTION_MAX_LENGTH)
  description!: string;

  /** UUID de la factura del libro mayor que respalda el cobro. */
  @IsString()
  @IsUUID()
  invoiceRef!: string;

  /**
   * Clave de idempotencia del cliente. es obligatorio: repetir la petición con
   * la misma clave devuelve la orden original sin volver a llamar al proveedor
   * ni a PayPal (ADR 003 §4). Por HTTP se toma del header `Idempotency-Key`.
   */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

/**
 * Solicitud opcional idempotente desde la herramienta MCP; si se omite, el
 * servidor usa el `requestId` del contexto como clave de idempotencia.
 */
export interface CreatePaymentLinkArgs {
  /** Entero positivo en unidad mínima; se rechazan floats o `.decimal`. */
  amountMinor: string;
  /** Código ISO 4217 en 3 letras. */
  currency: string;
  /** Máximo 127 caracteres (límite de PayPal). */
  description?: string;
  /** Factura que respalda el cobro. */
  invoiceId: string;
  /** Clave opcional de idempotencia del agente. */
  idempotencyKey?: string;
}

/** Resultado de la herramienta MCP `create_payment_link`. */
export interface CreatePaymentLinkResult {
  /** Identificador de la orden ante el proveedor. */
  paypalOrderId: string;
  /** Estado tras la creación; siempre `CREATED` en esta fase. */
  status: PayPalOrderStatus;
  /** Enlace de aprobación (`rel=approve`) del proveedor. */
  checkoutUrl: string;
  amountMinor: string;
  currency: string;
}

/**
 * Payload RPC `payments.paypal.orders.create`: DTO + contexto multi-tenant.
 * El `idempotencyKey` no es opcional en el contrato RPC interno.
 */
export type CreatePayPalOrderRpcPayload = CreatePayPalOrderDto & {
  tenantId: string;
  userId: string;
  role: UserRole;
};

/** Vista pública de la orden: nunca incluye la respuesta cruda del proveedor. */
export interface PayPalOrderView {
  id: string;
  tenantId: string;
  invoiceRef: string;
  paypalOrderId: string;
  status: PayPalOrderStatus;
  amountMinor: string;
  currency: string;
  checkoutUrl: string;
  createdAt: string;
}

/**
 * Roles con permiso de cobro (`payments:write`). Los endpoints de creación de
 * órdenes y la herramienta MCP de enlaces de pago exigen este conjunto; se
 * mantiene centralizado para que gateway, agent-service y cualquier superficie
 * nueva no dupliquen la matriz RBAC vigente (cuenta como detalle de política
 * admisible debido a que los claims granulares por token llegan en una fase
 * posterior del auth-service).
 */
export const PAYMENTS_WRITE_ROLES: readonly UserRole[] = [
  UserRole.ACCOUNTANT,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
];

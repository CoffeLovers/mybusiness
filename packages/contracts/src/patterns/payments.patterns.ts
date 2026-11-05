/** Patrones RPC del dominio de pagos (ADR 004 §2): `dominio.accion`. */
export const PaymentsPatterns = {
  /** Crea una orden PayPal idempotente asociada a una factura. */
  PAYPAL_CREATE_ORDER: 'payments.paypal.orders.create',
} as const;

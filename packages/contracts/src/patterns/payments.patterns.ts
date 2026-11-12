/** Patrones RPC del dominio de pagos (ADR 004 §2): `dominio.accion`. */
export const PaymentsPatterns = {
  /** Crea una orden PayPal idempotente asociada a una factura. */
  PAYPAL_CREATE_ORDER: 'payments.paypal.orders.create',
  /** Captura (total o parcial) una orden PayPal aprobada (SF3-09). */
  PAYPAL_CAPTURE: 'payments.paypal.orders.capture',
  /** Reembolsa (total o parcial, con motivo) una captura PayPal (SF3-09). */
  PAYPAL_REFUND: 'payments.paypal.orders.refund',
  /**
   * Webhook firmado del proveedor (SF3-09). Recibe payload + cabeceras + raw
   * body desde el BFF; finance-service verifica la firma fail-closed y
   * deduplica por `event_id`.
   */
  PAYPAL_HANDLE_WEBHOOK: 'payments.paypal.webhooks.handle',
} as const;

/** Eventos de dominio de pagos publicados por finance-service (SF3-09). */
export const PaymentEvents = {
  /** Fondos capturados y factura conciliada. */
  PAYPAL_CAPTURED: 'payments.paypal.captured',
  /** Fondos devueltos, con motivo y actor en el payload. */
  PAYPAL_REFUNDED: 'payments.paypal.refunded',
} as const;

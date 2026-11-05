/**
 * Estados del ciclo de vida de una orden PayPal, alineados con el enum
 * PostgreSQL `paypal_order_status` de `finance_db`. Ver ADR 003 y ADR 004.
 */
export enum PayPalOrderStatus {
  /** Orden creada en el proveedor, pendiente de aprobación del pagador. */
  CREATED = 'CREATED',
  /** El pagador aprobó el pago; la captura se ejecuta en SF3-09. */
  APPROVED = 'APPROVED',
  /** Fondos capturados y liquidables contra la factura. */
  CAPTURED = 'CAPTURED',
  /** La orden terminó con error (proveedor o expiración). */
  FAILED = 'FAILED',
  /** Fondos devueltos tras una captura (SF3-09). */
  REFUNDED = 'REFUNDED',
}

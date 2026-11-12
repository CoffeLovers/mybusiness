import { PayPalOrderStatus } from '@mybusiness/contracts';

/**
 * Máquina de estados de las órdenes PayPal (SF3-09). Mapa central declarativo:
 * cualquier transición no listada se rechaza con `PAYMENT_INVALID_TRANSITION`
 * (HTTP 409 desde la capa de servicio). Las consultas en `PaymentsRepository`
 * usan esta lista como fuente única.
 */
export const PAYPAL_ORDER_TRANSITIONS: Readonly<
  Record<PayPalOrderStatus, readonly PayPalOrderStatus[]>
> = {
  /** Un webhook `CHECKOUT.ORDER.APPROVED` aprueba; una captura directa salta a CAPTURED. */
  [PayPalOrderStatus.CREATED]: [
    PayPalOrderStatus.APPROVED,
    PayPalOrderStatus.CAPTURED,
    PayPalOrderStatus.FAILED,
  ],
  [PayPalOrderStatus.APPROVED]: [PayPalOrderStatus.CAPTURED, PayPalOrderStatus.FAILED],
  /** Reembolsos parciales conservan CAPTURED; el total agota la transición a REFUNDED. */
  [PayPalOrderStatus.CAPTURED]: [PayPalOrderStatus.REFUNDED],
  [PayPalOrderStatus.FAILED]: [],
  [PayPalOrderStatus.REFUNDED]: [],
};

/** Error tipado de transición inválida; el servicio lo mapea a HTTP 409. */
export class PayPalTransitionError extends Error {
  readonly code = 'PAYMENT_INVALID_TRANSITION';

  constructor(
    readonly from: PayPalOrderStatus,
    readonly to: PayPalOrderStatus,
  ) {
    super(`Transición inválida de ${from} a ${to}`);
    this.name = PayPalTransitionError.name;
  }
}

export function isPayPalTransitionAllowed(from: PayPalOrderStatus, to: PayPalOrderStatus): boolean {
  return PAYPAL_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Lanza `PayPalTransitionError` si la transición no está declarada en el mapa. */
export function requirePayPalTransition(from: PayPalOrderStatus, to: PayPalOrderStatus): void {
  if (!isPayPalTransitionAllowed(from, to)) {
    throw new PayPalTransitionError(from, to);
  }
}

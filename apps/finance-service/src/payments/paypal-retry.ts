import { randomInt } from 'node:crypto';
import { PayPalClientError, type PayPalClientErrorCode } from './paypal-client';

/**
 * Códigos de error del cliente PayPal considerados transitorios: reintentar
 * contra el proveedor es seguro y es el objetivo del backoff (SF3-09).
 * Errores de tipo AUTH, NOT_CONFIGURED o PROVIDER (rechazo del negocio) no se
 * reintentan para no persistir resultados indefinidos.
 */
export const PAYPAL_TRANSIENT_CODES: readonly PayPalClientErrorCode[] = [
  'PAYPAL_TIMEOUT',
  'PAYPAL_NETWORK',
  'PAYPAL_RATE_LIMITED',
];

export interface PayPalBackoffOptions {
  /** Intentos totales de la operación, incluido el primero. */
  maxAttempts: number;
  /** Retardo base del primer reintento en ms; crece exponencialmente. */
  baseDelayMs: number;
  /** Reloj de espera inyectable para tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Valores por defecto: exponencial con base 200 ms, 3 intentos, jitter ±25 %. */
export const PAYPAL_BACKOFF_DEFAULTS: PayPalBackoffOptions = {
  maxAttempts: 3,
  baseDelayMs: 200,
};

export function isTransientPayPalError(error: unknown): boolean {
  return (
    error instanceof PayPalClientError &&
    (PAYPAL_TRANSIENT_CODES as readonly string[]).includes(error.code)
  );
}

const sleepDefault = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Ejecuta `operation` con backoff exponencial + jitter para fallos
 * transitorios del proveedor (patrón del webhook bancario, #47): los
 * códigos no transitorios se propagan en el primer intento y el último error
 * de un agotamiento se propaga tal cual para que el estado visible quede
 * intacto (CAPTURED/APPROVED según el llamador, SF3-09).
 */
export async function runWithPaypalBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<PayPalBackoffOptions> = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, sleep } = { ...PAYPAL_BACKOFF_DEFAULTS, ...options };
  const aimSleep = sleep ?? sleepDefault;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientPayPalError(error)) {
        throw error;
      }

      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const jitterMax = Math.max(Math.round(baseDelayMs * 0.25), 1);
      const delay = exponential + randomInt(0, jitterMax);
      await aimSleep(delay);
    }
  }

  // Inalcanzable: el bucle siempre retorna o lanza.
  throw new PayPalClientError('PAYPAL_NETWORK', 'Reintentos agotados');
}

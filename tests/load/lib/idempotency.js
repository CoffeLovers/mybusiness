/**
 * Generador de claves de idempotencia y payloads deterministas para la prueba de carga del Issue #54.
 */

/**
 * Genera una clave de idempotencia única por corrida, VU e iteración.
 * Formato: `idem-${runId}-tx-${vu.padStart(4,'0')}-${iter.padStart(8,'0')}`
 *
 * @param {string} runId Identificador único de la corrida
 * @param {number|string} vu Identificador o índice del Virtual User (VU)
 * @param {number|string} iter Número de iteración del VU
 * @returns {string} Clave de idempotencia única y trazable
 */
export function generateTransactionIdempotencyKey(runId, vu, iter) {
  const vuStr = String(vu || 0).padStart(4, '0');
  const iterStr = String(iter || 0).padStart(8, '0');
  return `idem-${runId}-tx-${vuStr}-${iterStr}`;
}

/**
 * Genera un payload para la ingesta masiva (50.000 transacciones únicas).
 *
 * @param {string} runId
 * @param {string} bankAccountId
 * @param {string} currency
 * @param {number|string} vu
 * @param {number|string} iter
 * @returns {{ idempotencyKey: string, payload: object }}
 */
export function generateTransactionPayload(runId, bankAccountId, currency, vu, iter) {
  const idempotencyKey = generateTransactionIdempotencyKey(runId, vu, iter);
  const numIter = Number(iter) || 0;

  const amountMinor = String(1000 + ((numIter * 31 + Number(vu) * 7) % 500000));
  const types = ['INCOME', 'EXPENSE'];
  const type = types[numIter % 2];
  const categories = [
    'Operaciones',
    'Ventas',
    'Servicios en la nube',
    'Nómina',
    'Marketing',
    'Infraestructura',
    'Oficina',
  ];
  const category = categories[numIter % categories.length];

  return {
    idempotencyKey,
    payload: {
      bankAccountId,
      amountMinor,
      currency: currency || 'COP',
      type,
      description: `Ingesta transaccional VU:${vu} Iter:${iter} [${idempotencyKey}]`,
      category,
      idempotencyKey,
    },
  };
}

/**
 * Genera el payload para el probe de idempotencia (validación de replay y consistencia).
 *
 * @param {string} runId
 * @param {string} bankAccountId
 * @param {string} currency
 * @param {string|number} amountMinor
 * @returns {{ idempotencyKey: string, payload: object }}
 */
export function generateProbePayload(runId, bankAccountId, currency, amountMinor) {
  const idempotencyKey = `idem-${runId}-probe-0001`;

  return {
    idempotencyKey,
    payload: {
      bankAccountId,
      amountMinor: String(amountMinor || '12345'),
      currency: currency || 'COP',
      type: 'INCOME',
      description: `Probe de idempotencia pre-carga [${idempotencyKey}]`,
      category: 'Operaciones',
      idempotencyKey,
    },
  };
}

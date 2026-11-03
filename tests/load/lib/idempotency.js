/**
 * Generador de claves de idempotencia y payloads deterministas para la prueba de carga.
 */

/**
 * Genera una clave de idempotencia determinista para un tenant y secuencia dados.
 * @param {string} tenantId Identificador del tenant
 * @param {number} seq Número de secuencia secuencial o de iteración
 * @returns {string} Clave de idempotencia única y determinista
 */
export function generateDeterministicIdempotencyKey(tenantId, seq) {
  const padded = String(seq).padStart(8, '0');
  return `idem-${tenantId.slice(0, 8)}-${padded}`;
}

/**
 * Genera un payload válido para `POST /api/v1/finance/transactions`.
 * Cada 20 transacciones (~5%) inyecta una clave de idempotencia duplicada
 * para verificar la deduplicación del sistema.
 *
 * @param {string} tenantId
 * @param {string} bankAccountId
 * @param {number} iteration
 * @returns {{ payload: object, isDuplicate: boolean, idempotencyKey: string }}
 */
export function generateTransactionPayload(tenantId, bankAccountId, iteration) {
  // Simulación de duplicados intencionales (cada 20 peticiones, repite la transacción previa)
  const isDuplicate = iteration > 0 && iteration % 20 === 0;
  const seq = isDuplicate ? iteration - 1 : iteration;
  const idempotencyKey = generateDeterministicIdempotencyKey(tenantId, seq);

  const amountMinor = String(1000 + ((iteration * 17) % 500000));
  const types = ['INCOME', 'EXPENSE'];
  const type = types[iteration % 2];
  const categories = ['Operaciones', 'Ventas', 'Servicios', 'Nómina', 'Marketing', 'Infraestructura'];
  const category = categories[iteration % categories.length];

  return {
    isDuplicate,
    idempotencyKey,
    payload: {
      bankAccountId: bankAccountId || '00000000-0000-4000-8000-000000000001',
      amountMinor,
      currency: 'EUR',
      type,
      description: `Carga transaccional #${iteration} [${idempotencyKey}]`,
      category,
      idempotencyKey,
    },
  };
}

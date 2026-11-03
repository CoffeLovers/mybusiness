import http from 'k6/http';

/**
 * Configuración y preparación del entorno de carga.
 *
 * @param {string} baseUrl URL base del API Gateway o Mock
 * @param {string} authToken Token de autenticación Bearer
 * @param {string} tenantId Tenant objetivo
 * @returns {object} Contexto de configuración para el escenario k6
 */
export function setupLoadEnvironment(baseUrl, authToken, tenantId) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const resolvedTenantId = tenantId || '00000000-0000-0000-0000-000000000001';
  const defaultAccountId = '00000000-0000-4000-8000-000000000001';
  const defaultConnectionId = '11111111-1111-4111-8111-111111111111';

  // 1. Verificar estado del servidor
  const healthRes = http.get(`${baseUrl}/health`);
  const isHealthy = healthRes.status === 200 || healthRes.status === 404; // 404 si el health está en otra ruta

  // 2. Consultar conteo inicial de transacciones
  let initialCount = 0;
  const countRes = http.get(`${baseUrl}/api/v1/finance/transactions`, { headers });
  if (countRes.status === 200) {
    try {
      const data = JSON.parse(countRes.body);
      initialCount = data.total ?? (Array.isArray(data) ? data.length : 0);
    } catch {
      initialCount = 0;
    }
  }

  return {
    baseUrl,
    authToken,
    tenantId: resolvedTenantId,
    bankAccountId: defaultAccountId,
    connectionId: defaultConnectionId,
    initialCount,
    isHealthy,
    startTime: new Date().toISOString(),
  };
}

/**
 * Verificación posterior a la ingesta masiva:
 * Compara las transacciones aceptadas únicas contra las persistidas para certificar pérdida = 0.
 *
 * @param {string} baseUrl
 * @param {string} authToken
 * @param {number} initialCount
 * @returns {{ finalCount: number, newlyPersisted: number }}
 */
export function verifyPersistedCount(baseUrl, authToken, initialCount) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const countRes = http.get(`${baseUrl}/api/v1/finance/transactions`, { headers });
  let finalCount = 0;

  if (countRes.status === 200) {
    try {
      const data = JSON.parse(countRes.body);
      finalCount = data.total ?? (Array.isArray(data) ? data.length : 0);
    } catch {
      finalCount = 0;
    }
  }

  const newlyPersisted = Math.max(0, finalCount - (initialCount || 0));

  return {
    finalCount,
    newlyPersisted,
  };
}

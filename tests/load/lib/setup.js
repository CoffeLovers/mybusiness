import http from 'k6/http';

/**
 * Configuración y preparación del entorno de carga real (o mock en modo compatibilidad).
 *
 * @returns {{
 *   baseUrl: string,
 *   authToken: string,
 *   tenantId: string,
 *   bankAccountId: string,
 *   currency: string,
 *   runId: string,
 *   startedAt: string
 * }}
 */
export function setupLoadEnvironment() {
  const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3000';
  const runId = __ENV.RUN_ID || `load54-${Date.now()}`;
  const targetCurrency = __ENV.LOAD_CURRENCY || 'COP';
  const startedAt = new Date().toISOString();

  // 1. Health check del Gateway
  const healthRes = http.get(`${baseUrl}/api/v1/health`, { responseType: 'text' });
  if (healthRes.status !== 200) {
    throw new Error(
      `Health check falló en ${baseUrl}/api/v1/health: HTTP ${healthRes.status} - ${healthRes.body}`,
    );
  }

  let authToken = __ENV.AUTH_TOKEN;
  let tenantId = __ENV.TENANT_ID || '00000000-0000-0000-0000-000000000001';

  // Modo compatibilidad: si se proporciona AUTH_TOKEN explícito, omitir login
  if (!authToken) {
    const email = __ENV.SEED_ADMIN_EMAIL;
    const password = __ENV.SEED_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'Faltan variables SEED_ADMIN_EMAIL y/o SEED_ADMIN_PASSWORD para autenticación en stack real',
      );
    }

    const loginRes = http.post(
      `${baseUrl}/api/v1/auth/login`,
      JSON.stringify({ email, password }),
      { headers: { 'Content-Type': 'application/json' }, responseType: 'text' },
    );

    if (loginRes.status !== 200 && loginRes.status !== 201) {
      throw new Error(
        `Login falló en ${baseUrl}/api/v1/auth/login: HTTP ${loginRes.status} - ${loginRes.body}`,
      );
    }

    const loginBody = loginRes.json();
    const session = loginBody.data ?? loginBody;
    authToken = session.accessToken;
    tenantId = session.user?.tenantId;

    if (!authToken || !tenantId) {
      throw new Error(`Respuesta de login inválida: ${JSON.stringify(loginBody)}`);
    }
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  // 2. Resolver o crear cuenta bancaria con la divisa solicitada
  const accountsRes = http.get(`${baseUrl}/api/v1/finance/accounts`, {
    headers: authHeaders,
    responseType: 'text',
  });
  if (accountsRes.status !== 200) {
    throw new Error(`Consulta de cuentas falló: HTTP ${accountsRes.status} - ${accountsRes.body}`);
  }

  const accountsBody = accountsRes.json();
  const accountsList = Array.isArray(accountsBody)
    ? accountsBody
    : Array.isArray(accountsBody.data)
      ? accountsBody.data
      : [];

  let matchedAccount = accountsList.find(
    (acc) => acc.currency === targetCurrency && acc.status !== 'INACTIVE',
  );

  let bankAccountId;
  let currency;

  if (matchedAccount) {
    bankAccountId = matchedAccount.id;
    currency = matchedAccount.currency;
  } else {
    const createAccountPayload = JSON.stringify({
      institutionName: 'Load Test Bank',
      accountType: 'CHECKING',
      accountNumberMasked: '******0054',
      currency: targetCurrency,
    });

    const createRes = http.post(`${baseUrl}/api/v1/finance/accounts`, createAccountPayload, {
      headers: authHeaders,
      responseType: 'text',
    });

    if (createRes.status !== 200 && createRes.status !== 201) {
      throw new Error(
        `Creación de cuenta bancaria falló: HTTP ${createRes.status} - ${createRes.body}`,
      );
    }

    const createdBody = createRes.json();
    const accountData = createdBody.data ?? createdBody;
    bankAccountId = accountData.id;
    currency = accountData.currency || targetCurrency;
  }

  return {
    baseUrl,
    authToken,
    tenantId,
    bankAccountId,
    currency,
    runId,
    startedAt,
  };
}

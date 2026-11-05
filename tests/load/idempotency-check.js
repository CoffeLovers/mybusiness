import http from 'k6/http';
import { check } from 'k6';
import { generateProbePayload } from './lib/idempotency.js';
import { setupLoadEnvironment } from './lib/setup.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'],
  },
};

export function setup() {
  console.log('[idempotency-check setup] Inicializando entorno para probe de idempotencia...');
  return setupLoadEnvironment();
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.authToken}`,
  };

  const endpoint = `${data.baseUrl}/api/v1/finance/transactions`;

  // 1. Primer envío: creación original con amountMinor="12345"
  const { payload: probePayload1 } = generateProbePayload(
    data.runId,
    data.bankAccountId,
    data.currency,
    '12345',
  );

  const res1 = http.post(endpoint, JSON.stringify(probePayload1), { headers });
  const check1 = check(res1, {
    'primer POST devuelve 201': (r) => r.status === 201,
  });

  if (!check1) {
    throw new Error(`Primer POST falló con status ${res1.status}: ${res1.body}`);
  }

  const json1 = res1.json();
  const tx1 = json1.data ?? json1;
  const initialId = tx1.id;
  const initialAmount = tx1.amountMinor;

  console.log(`[idempotency-check] Creada transacción probe: id=${initialId}, amount=${initialAmount}`);

  // 2. Replay idéntico: mismo body y misma clave -> debe devolver 201 y mismo ID
  const res2 = http.post(endpoint, JSON.stringify(probePayload1), { headers });
  const json2 = res2.json();
  const tx2 = json2.data ?? json2;

  check(res2, {
    'replay idéntico devuelve 201': (r) => r.status === 201,
    'replay idéntico devuelve el mismo id': () => tx2.id === initialId,
    'replay idéntico mantiene amountMinor original': () => tx2.amountMinor === initialAmount,
  });

  // 3. Envío con la misma clave pero diferente amountMinor ("99999")
  // El replay idempotente no debe mutar el registro original
  const { payload: probePayload2 } = generateProbePayload(
    data.runId,
    data.bankAccountId,
    data.currency,
    '99999',
  );

  const res3 = http.post(endpoint, JSON.stringify(probePayload2), { headers });
  const json3 = res3.json();
  const tx3 = json3.data ?? json3;

  check(res3, {
    'replay con payload alterado devuelve 201': (r) => r.status === 201,
    'replay alterado devuelve el mismo id original': () => tx3.id === initialId,
    'replay alterado NO muta amountMinor original (sigue siendo 12345)': () =>
      tx3.amountMinor === '12345',
  });

  console.log('[idempotency-check] Verificación de idempotencia completada exitosamente.');
}

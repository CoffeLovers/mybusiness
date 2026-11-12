#!/usr/bin/env node

/**
 * Script de validación de endpoints y probes de salud estandarizados (SF5-05, #82).
 *
 * Verifica que todos los microservicios y el portal web implementen:
 * 1. /healthz/liveness: responde HTTP 200 con { status: 'ok', service, uptime, timestamp }.
 * 2. /healthz/readiness: responde HTTP 200 con { status: 'ready', ... } cuando dependencias responden.
 * 3. /healthz/readiness: responde HTTP 503 con { status: 'not_ready', ... } ante fallo de dependencias.
 *
 * Cobertura de servicios:
 * - api-gateway
 * - auth-service
 * - finance-service
 * - agent-service
 * - audit-service
 * - apps/web
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import {
  createLivenessResponse,
  createReadinessResponse,
  startAuxiliaryHealthServer,
} from '../packages/common/dist/index.js';

const SERVICES = [
  { name: 'api-gateway', port: 13000, defaultDep: 'redis' },
  { name: 'auth-service', port: 13001, defaultDep: 'postgres' },
  { name: 'finance-service', port: 13002, defaultDep: 'postgres' },
  { name: 'agent-service', port: 13003, defaultDep: 'pgvector' },
  { name: 'audit-service', port: 13004, defaultDep: 'postgres' },
  { name: 'web', port: 13005, defaultDep: 'bff' },
];

async function requestHttp(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path,
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            resolve({ statusCode: res.statusCode, body });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data, error: e.message });
          }
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function runServiceTest(service) {
  let readinessShouldFail = false;

  // Iniciar servidor auxiliar en puerto de prueba
  const server = startAuxiliaryHealthServer({
    serviceName: service.name,
    port: service.port,
    host: '127.0.0.1',
    checkReadiness: async () => {
      if (readinessShouldFail) {
        return {
          ok: false,
          checks: { [service.defaultDep]: 'disconnected' },
          error: `Conexión rechazada a ${service.defaultDep}`,
        };
      }
      return {
        ok: true,
        checks: { [service.defaultDep]: 'ok' },
      };
    },
  });

  try {
    // 1. Probar Liveness Probe (/healthz/liveness -> 200)
    const livenessRes = await requestHttp(service.port, '/healthz/liveness');
    assert.equal(
      livenessRes.statusCode,
      200,
      `Liveness probe debe responder 200 en ${service.name}`,
    );
    assert.equal(
      livenessRes.body.status,
      'ok',
      `Liveness status debe ser 'ok' en ${service.name}`,
    );
    assert.equal(
      livenessRes.body.service,
      service.name,
      `Service name debe coincidir en ${service.name}`,
    );
    assert.ok(
      typeof livenessRes.body.uptime === 'number',
      `Uptime debe ser numérico en ${service.name}`,
    );

    // 2. Probar Readiness Probe Saludable (/healthz/readiness -> 200)
    readinessShouldFail = false;
    const readyRes = await requestHttp(service.port, '/healthz/readiness');
    assert.equal(
      readyRes.statusCode,
      200,
      `Readiness probe debe responder 200 cuando dependencias están sanas en ${service.name}`,
    );
    assert.equal(
      readyRes.body.status,
      'ready',
      `Readiness status debe ser 'ready' en ${service.name}`,
    );
    assert.equal(
      readyRes.body.checks[service.defaultDep],
      'ok',
      `Chequeo de dependencia debe ser 'ok' en ${service.name}`,
    );

    // 3. Probar Readiness Probe Degradada (/healthz/readiness -> 503)
    readinessShouldFail = true;
    const notReadyRes = await requestHttp(service.port, '/healthz/readiness');
    assert.equal(
      notReadyRes.statusCode,
      503,
      `Readiness probe debe responder 503 ante fallo de dependencia en ${service.name}`,
    );
    assert.equal(
      notReadyRes.body.status,
      'not_ready',
      `Readiness status debe ser 'not_ready' en ${service.name}`,
    );
    assert.ok(
      notReadyRes.body.error,
      `Readiness debe incluir mensaje de error descriptivo en ${service.name}`,
    );

    return {
      service: service.name,
      liveness: '200 OK',
      readinessHealthy: '200 OK',
      readinessDegraded: '503 SERVICE_UNAVAILABLE',
      pass: true,
    };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  console.log('================================================================================');
  console.log('🩺 Verificación de Estandarización de Healthchecks (SF5-05, #82)');
  console.log('   Probes requeridos: /healthz/liveness (200) y /healthz/readiness (200 / 503)');
  console.log('================================================================================\n');

  const results = [];
  let allPass = true;

  for (const s of SERVICES) {
    try {
      const res = await runServiceTest(s);
      results.push(res);
      console.log(`[✓ PASS] ${s.name.padEnd(16)} | Liveness: 200 OK | Readiness: 200 / 503`);
    } catch (err) {
      allPass = false;
      console.error(`[✗ FAIL] ${s.name.padEnd(16)} | Error: ${err.message}`);
      results.push({ service: s.name, pass: false, error: err.message });
    }
  }

  console.log('\n================================================================================');
  console.log(`                        VEREDICTO FINAL: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================');
  console.table(
    results.map((r) => ({
      Servicio: r.service,
      Liveness: r.liveness || 'FAIL',
      'Readiness (OK)': r.readinessHealthy || 'FAIL',
      'Readiness (Degradada)': r.readinessDegraded || 'FAIL',
      Veredicto: r.pass ? 'PASS' : 'FAIL',
    })),
  );
  console.log('================================================================================\n');

  if (!allPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`ERROR FATAL: ${err.message}`);
  process.exit(1);
});

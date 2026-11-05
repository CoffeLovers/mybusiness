#!/usr/bin/env node

/**
 * Script de verificación de base de datos e integridad de eventos para el Issue #54 (SF2-12).
 *
 * Consulta PostgreSQL real vía docker exec para verificar:
 * 1. Transacciones persistidas en finance_db vs aceptadas por k6.
 * 2. Cero duplicados en claves de idempotencia.
 * 3. 0 eventos perdidos en audit_db (audit_logs vs transactions).
 * 4. 0 eventos en audit_dead_letters.
 * 5. Consistencia del probe de idempotencia (1 fila, importe inalterado).
 * 6. Cumplimiento estricto de p95, error HTTP y 429.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--run-id' && i + 1 < args.length) {
      options.runId = args[++i];
    } else if (arg === '--email' && i + 1 < args.length) {
      options.email = args[++i];
    } else if (arg === '--db-user' && i + 1 < args.length) {
      options.dbUser = args[++i];
    }
  }

  // Fallbacks de variables de entorno
  options.runId = options.runId || process.env.RUN_ID;
  options.email = options.email || process.env.SEED_ADMIN_EMAIL || 'ada.lovelace@example.com';
  options.dbUser = options.dbUser || process.env.POSTGRES_USER || 'mybusiness_admin';

  if (!options.runId) {
    console.error('ERROR: Falta el parámetro --run-id o la variable de entorno RUN_ID');
    process.exit(1);
  }

  return options;
}

function runSql(dbUser, dbName, sql) {
  // docker exec mybusiness_postgres psql -U <user> -d <db> -t -A -F '|' -c "<sql>"
  const escapedSql = sql.replace(/"/g, '\\"');
  const cmd = `docker exec mybusiness_postgres psql -U ${dbUser} -d ${dbName} -t -A -F "|" -c "${escapedSql}"`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return stdout.trim();
  } catch (err) {
    throw new Error(`Error ejecutando SQL en ${dbName}: ${err.message} (stderr: ${err.stderr})`);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { runId, email, dbUser } = parseArgs();

  console.log('================================================================================');
  console.log(`🔍 Iniciando verificación de carga y persistencia para RUN_ID: ${runId}`);
  console.log(`👤 Usuario seed: ${email} | DB User: ${dbUser}`);
  console.log('================================================================================');

  // 1. Resolver tenant_id desde auth_db
  console.log('1. Resolviendo tenant_id en auth_db...');
  const tenantSql = `SELECT tenant_id FROM users WHERE email = '${email}' LIMIT 1;`;
  const tenantId = runSql(dbUser, 'auth_db', tenantSql);

  if (!tenantId) {
    console.error(`ERROR: No se encontró tenant_id para el email ${email} en auth_db.`);
    process.exit(1);
  }
  console.log(`✓ Tenant identificado: ${tenantId}`);

  // 2. Leer k6-summary.json
  const summaryPath = resolve('tests/load/k6-summary.json');
  console.log(`2. Leyendo resumen k6 desde ${summaryPath}...`);
  let k6Summary;
  try {
    const raw = readFileSync(summaryPath, 'utf8');
    k6Summary = JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: No se pudo leer ${summaryPath}: ${err.message}`);
    process.exit(1);
  }

  const metrics = k6Summary.metrics || {};
  const transactionsAccepted = metrics.transactions_accepted?.values?.count ?? 0;
  const uniqueTransactionsK6 = metrics.unique_transactions?.values?.count ?? 0;
  const p95 = metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const p99 = metrics.http_req_duration?.values?.['p(99)'] ?? 0;
  const httpReqFailedRate = metrics.http_req_failed?.values?.rate ?? 0;
  const droppedIterations = metrics.dropped_iterations?.values?.count ?? 0;
  const http429Count = metrics.http_429?.values?.count ?? 0;

  console.log(
    `✓ Métricas k6: aceptadas=${transactionsAccepted}, p95=${p95.toFixed(2)}ms, fallos=${(httpReqFailedRate * 100).toFixed(2)}%, 429=${http429Count}`,
  );

  // 3. Consultar finance_db
  console.log('3. Consultando transacciones en finance_db...');
  const statsSql = `
    SELECT count(*), count(DISTINCT idempotency_key), min(created_at), max(created_at)
    FROM transactions
    WHERE tenant_id = '${tenantId}'
      AND idempotency_key LIKE 'idem-${runId}-tx-%';
  `;
  const statsRes = runSql(dbUser, 'finance_db', statsSql);
  const [totalStr, distinctStr, minCreatedAt, maxCreatedAt] = statsRes.split('|');

  const transactionsForRun = parseInt(totalStr || '0', 10);
  const distinctKeys = parseInt(distinctStr || '0', 10);

  console.log(`✓ Transacciones en finance_db: total=${transactionsForRun}, únicas=${distinctKeys}`);
  console.log(`✓ Ventana temporal: [${minCreatedAt}  ${maxCreatedAt}]`);

  // Duplicados en finance_db
  const dupSql = `
    SELECT count(*) FROM (
      SELECT idempotency_key FROM transactions
      WHERE tenant_id = '${tenantId}' AND idempotency_key LIKE 'idem-${runId}-tx-%'
      GROUP BY idempotency_key HAVING count(*) > 1
    ) dup;
  `;
  const duplicateKeys = parseInt(runSql(dbUser, 'finance_db', dupSql) || '0', 10);

  // Probe de idempotencia
  const probeSql = `
    SELECT count(*), min(amount_minor) FROM transactions
    WHERE tenant_id = '${tenantId}' AND idempotency_key = 'idem-${runId}-probe-0001';
  `;
  const [probeRowsStr, probeAmountMinor] = runSql(dbUser, 'finance_db', probeSql).split('|');
  const probeRows = parseInt(probeRowsStr || '0', 10);

  // 4. Consultar audit_db y esperar estabilización
  console.log('4. Consultando eventos en audit_db y esperando estabilización del consumidor...');
  let auditForRun = 0;
  let stableCount = 0;
  let lastAuditCount = -1;
  const maxRetries = 40; // 40 * 15s = 10 minutos máx

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Tolerancia de ±5 minutos: el evento de auditoría de la última transacción se publica
    // DESPUÉS del insert de su fila, por lo que su timestamp puede superar maxCreatedAt.
    const auditSql = `
      SELECT count(*) FROM audit_logs
      WHERE tenant_id = '${tenantId}'
        AND action = 'finance.transaction.created'
        AND entity_name = 'Transaction'
        AND timestamp >= ('${minCreatedAt}'::timestamptz - interval '5 minutes')
        AND timestamp <= ('${maxCreatedAt}'::timestamptz + interval '5 minutes');
    `;
    auditForRun = parseInt(runSql(dbUser, 'audit_db', auditSql) || '0', 10);

    console.log(
      `  Intento ${attempt}/${maxRetries}: audit_logs=${auditForRun} (esperadas: ${transactionsForRun})`,
    );

    if (auditForRun === transactionsForRun) {
      console.log('✓ Se alcanzó paridad exacta: audit_for_run == transactions_for_run.');
      break;
    }

    if (auditForRun === lastAuditCount) {
      stableCount++;
      if (stableCount >= 3) {
        console.log(
          `✓ Lecturas estabilizadas en ${auditForRun} eventos tras 3 iteraciones idénticas.`,
        );
        break;
      }
    } else {
      stableCount = 0;
      lastAuditCount = auditForRun;
    }

    await sleep(15000);
  }

  // Dead letters
  const dlSql = `
    SELECT count(*) FROM audit_dead_letters
    WHERE tenant_id = '${tenantId}' AND failed_at >= '${minCreatedAt}';
  `;
  const deadLetters = parseInt(runSql(dbUser, 'audit_db', dlSql) || '0', 10);

  // Diagnóstico de límites: eventos incluidos solo por la tolerancia de ±5 minutos
  // (fuera de la ventana original [minCreatedAt, maxCreatedAt]). La DB es efímera y
  // contiene únicamente datos de esta corrida, por lo que no hay contaminación cruzada.
  const auditFilter = `tenant_id = '${tenantId}' AND action = 'finance.transaction.created' AND entity_name = 'Transaction'`;
  const minTsExpr = `'${minCreatedAt}'::timestamptz`;
  const maxTsExpr = `'${maxCreatedAt}'::timestamptz`;

  const beforeWindowSql = `
    SELECT count(*) FROM audit_logs
    WHERE ${auditFilter}
      AND timestamp >= (${minTsExpr} - interval '5 minutes')
      AND timestamp < ${minTsExpr};
  `;
  const afterWindowSql = `
    SELECT count(*) FROM audit_logs
    WHERE ${auditFilter}
      AND timestamp > ${maxTsExpr}
      AND timestamp <= (${maxTsExpr} + interval '5 minutes');
  `;
  const eventsBeforeWindow = parseInt(runSql(dbUser, 'audit_db', beforeWindowSql) || '0', 10);
  const eventsAfterWindow = parseInt(runSql(dbUser, 'audit_db', afterWindowSql) || '0', 10);
  console.log(
    `Eventos fuera de ventana por tolerancia: inicio=${eventsBeforeWindow} fin=${eventsAfterWindow}`,
  );

  if (eventsBeforeWindow > 0) {
    const beforeTsSql = `
      SELECT timestamp FROM audit_logs
      WHERE ${auditFilter}
        AND timestamp >= (${minTsExpr} - interval '5 minutes')
        AND timestamp < ${minTsExpr}
      ORDER BY timestamp
      LIMIT 3;
    `;
    const beforeTs = runSql(dbUser, 'audit_db', beforeTsSql)
      .split('\n')
      .filter(Boolean)
      .join(' | ');
    console.log(`  [evidencia] 3 timestamps extremos por debajo del inicio: ${beforeTs}`);
  }

  if (eventsAfterWindow > 0) {
    const afterTsSql = `
      SELECT timestamp FROM audit_logs
      WHERE ${auditFilter}
        AND timestamp > ${maxTsExpr}
        AND timestamp <= (${maxTsExpr} + interval '5 minutes')
      ORDER BY timestamp DESC
      LIMIT 3;
    `;
    const afterTs = runSql(dbUser, 'audit_db', afterTsSql).split('\n').filter(Boolean).join(' | ');
    console.log(`  [evidencia] 3 timestamps extremos por encima del fin: ${afterTs}`);
  }

  // 5. Evaluación de Criterios de Aceptación
  const eventLossCount = Math.max(0, transactionsForRun - auditForRun);
  const eventLossRate = transactionsForRun > 0 ? eventLossCount / transactionsForRun : 0;

  const checks = {
    transactions_accepted_ge_50k: {
      actual: transactionsAccepted,
      required: '>= 50000',
      pass: transactionsAccepted >= 50000,
    },
    transactions_for_run_ge_50k: {
      actual: transactionsForRun,
      required: '>= 50000',
      pass: transactionsForRun >= 50000,
    },
    distinct_keys_match_total: {
      actual: distinctKeys,
      expected: transactionsForRun,
      pass: distinctKeys === transactionsForRun && duplicateKeys === 0,
    },
    no_accepted_transactions_lost: {
      actual: transactionsForRun,
      expected: `>= ${transactionsAccepted}`,
      pass: transactionsForRun >= transactionsAccepted,
    },
    event_loss_zero: {
      audit_events: auditForRun,
      transactions: transactionsForRun,
      event_loss_rate: `${(eventLossRate * 100).toFixed(4)}%`,
      pass: auditForRun === transactionsForRun && eventLossCount === 0,
    },
    dead_letters_zero: {
      actual: deadLetters,
      required: 0,
      pass: deadLetters === 0,
    },
    idempotency_probe_intact: {
      probe_rows: probeRows,
      amount_minor: probeAmountMinor,
      pass: probeRows === 1 && probeAmountMinor === '12345',
    },
    latency_p95: {
      actual_ms: p95,
      required_ms: '< 5000',
      pass: p95 < 5000,
    },
    error_rate: {
      actual: httpReqFailedRate,
      required: '< 0.01',
      pass: httpReqFailedRate < 0.01,
    },
    dropped_iterations: {
      actual: droppedIterations,
      required: 0,
      pass: droppedIterations === 0,
    },
    rate_limiting_429: {
      actual: http429Count,
      required: 0,
      pass: http429Count === 0,
    },
  };

  const isAllPassed = Object.values(checks).every((c) => c.pass === true);
  const verdict = isAllPassed ? 'PASS' : 'FAIL';

  const verificationResult = {
    verdict,
    runId,
    tenantId,
    verifiedAt: new Date().toISOString(),
    window: {
      minCreatedAt,
      maxCreatedAt,
    },
    k6Summary: {
      transactionsAccepted,
      uniqueTransactionsK6,
      p95,
      p99,
      httpReqFailedRate,
      droppedIterations,
      http429Count,
    },
    databaseMetrics: {
      transactionsForRun,
      distinctKeys,
      duplicateKeys,
      auditForRun,
      deadLetters,
      eventLossCount,
      eventLossRate,
      probe: {
        probeRows,
        probeAmountMinor,
      },
    },
    criteria: checks,
  };

  const outputPath = resolve('tests/load/verification-54.json');
  writeFileSync(outputPath, JSON.stringify(verificationResult, null, 2), 'utf8');
  console.log(`\n📄 Resultado de verificación guardado en: ${outputPath}`);

  console.log('\n================================================================================');
  console.log(`                        VEREDICTO FINAL: ${verdict}`);
  console.log('================================================================================');
  for (const [key, check] of Object.entries(checks)) {
    const icon = check.pass ? '✓ PASS' : '✗ FAIL';
    console.log(`[${icon}] ${key}: ${JSON.stringify(check)}`);
  }
  console.log('================================================================================\n');

  if (!isAllPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`ERROR FATAL durante la verificación: ${err.message}`);
  process.exit(1);
});

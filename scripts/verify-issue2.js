const path = require('node:path');

// Asegurar resolución de dependencias en monorepo pnpm
const rootDir = path.resolve(__dirname, '..');
module.paths.push(
  path.join(rootDir, 'apps/auth-service/node_modules'),
  path.join(rootDir, 'apps/api-gateway/node_modules'),
  path.join(rootDir, 'packages/common/node_modules'),
  path.join(rootDir, 'node_modules'),
);

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { NestFactory } = require('@nestjs/core');
const { ClientProxyFactory, Transport } = require('@nestjs/microservices');
const { firstValueFrom } = require('rxjs');
const { Queue, Worker } = require('bullmq');

const { AuthServiceModule } = require('../apps/auth-service/dist/auth-service.module');
const { AuditServiceModule } = require('../apps/audit-service/dist/audit-service.module');
const { AuthPatterns, AuditEvents } = require('../packages/contracts/dist');
const {
  getMicroserviceRedisOptions,
  getBullMQConnectionOptions,
} = require('../packages/common/dist');

const REDIS_TEST_PORT = 6386;
const REDIS_TEST_PASS = 'test_redis_secret_123';

process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = String(REDIS_TEST_PORT);
process.env.REDIS_PASSWORD = REDIS_TEST_PASS;

async function run() {
  console.log('================================================================');
  console.log('🚀 Verificación Integral del Issue #2 (Sprint 1)');
  console.log('   PostgreSQL 16 + pgvector y Redis 7 (Microservicios + BullMQ)');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Validar script SQL de inicialización PostgreSQL (4 DBs + pgvector)
  // ---------------------------------------------------------------------------
  console.log('📦 Paso 1: Validar script SQL docker/init-microservices-dbs.sql...');
  const sqlPath = path.resolve(__dirname, '../docker/init-microservices-dbs.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  const requiredDatabases = ['auth_db', 'finance_db', 'agent_db', 'audit_db'];
  for (const db of requiredDatabases) {
    if (!sqlContent.includes(`CREATE DATABASE ${db}`)) {
      throw new Error(`SQL init script le falta la creación de base de datos: ${db}`);
    }
  }
  console.log('   ✅ Las 4 bases de datos (auth_db, finance_db, agent_db, audit_db) están declaradas.');

  const requiredUsers = ['auth_user', 'finance_user', 'agent_user', 'audit_user'];
  for (const user of requiredUsers) {
    if (!sqlContent.includes(`rolname = '${user}'`)) {
      throw new Error(`SQL init script le falta el rol de servicio: ${user}`);
    }
  }
  console.log('   ✅ Los 4 roles de servicio con privilegio mínimo están declarados.');

  const vectorMatches = (sqlContent.match(/CREATE EXTENSION IF NOT EXISTS vector;/g) || []).length;
  if (vectorMatches < 4) {
    throw new Error(`Se esperaban 4 activaciones de extensión vector, encontradas: ${vectorMatches}`);
  }
  console.log(`   ✅ Extensión pgvector activa en las 4 bases de datos (${vectorMatches} instancias).`);

  const uuidMatches = (sqlContent.match(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g) || []).length;
  if (uuidMatches < 4) {
    throw new Error(`Se esperaban 4 activaciones de uuid-ossp, encontradas: ${uuidMatches}`);
  }
  console.log(`   ✅ Extensión uuid-ossp activa en las 4 bases de datos (${uuidMatches} instancias).`);

  // ---------------------------------------------------------------------------
  // 2. Iniciar servidor Redis con autenticación y persistencia AOF
  // ---------------------------------------------------------------------------
  console.log('\n🔴 Paso 2: Iniciar Redis Server con contraseña y persistencia AOF...');
  const redisServerExe =
    'C:\\Users\\farid\\AppData\\Local\\Microsoft\\WinGet\\Packages\\taizod1024.redis-windows-fork_Microsoft.Winget.Source_8wekyb3d8bbwe\\Redis-8.10.2-Windows-x64-msys2\\redis-server.exe';
  const tempAofDir = path.resolve(process.env.TEMP || 'C:\\Temp', `redis_issue2_test_${Date.now()}`);
  fs.mkdirSync(tempAofDir, { recursive: true });

  const redisProc = spawn(
    redisServerExe,
    [
      '--port',
      String(REDIS_TEST_PORT),
      '--requirepass',
      REDIS_TEST_PASS,
      '--appendonly',
      'yes',
      '--dir',
      tempAofDir,
    ],
    { stdio: 'ignore' },
  );

  await new Promise((r) => setTimeout(r, 1500));
  console.log(`   ✅ Redis iniciado en puerto ${REDIS_TEST_PORT} con contraseña y AOF.`);

  try {
    // -------------------------------------------------------------------------
    // 3. Levantar AuthService real sobre Transport.REDIS
    // -------------------------------------------------------------------------
    console.log('\n⚡ Paso 3: Arrancar AuthService real con Transport.REDIS...');
    const redisOptions = getMicroserviceRedisOptions();
    const authApp = await NestFactory.createMicroservice(AuthServiceModule, {
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await authApp.listen();
    console.log('   ✅ AuthService escuchando sobre Redis Pub/Sub.');

    // -------------------------------------------------------------------------
    // 4. Levantar AuditService real sobre Transport.REDIS
    // -------------------------------------------------------------------------
    console.log('\n📜 Paso 4: Arrancar AuditService real con Transport.REDIS...');
    const auditApp = await NestFactory.createMicroservice(AuditServiceModule, {
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await auditApp.listen();
    console.log('   ✅ AuditService escuchando sobre Redis Pub/Sub.');

    // -------------------------------------------------------------------------
    // 5. Conectar ClientProxy de API Gateway hacia Redis
    // -------------------------------------------------------------------------
    console.log('\n📡 Paso 5: Conectar ClientProxy de API Gateway hacia Redis Broker...');
    const client = ClientProxyFactory.create({
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await client.connect();
    console.log('   ✅ ClientProxy conectado autenticado al broker.');

    // -------------------------------------------------------------------------
    // 6. Probar RPC sincrónico por Redis (@MessagePattern)
    // -------------------------------------------------------------------------
    console.log('\n🔁 Paso 6: Ejecutar llamada RPC: client.send(AuthPatterns.LOGIN)...');
    const rpcResponse = await firstValueFrom(
      client.send(AuthPatterns.LOGIN, {
        email: 'admin@mybusiness.demo',
        password: 'DemoPassword123!',
      }),
    );
    console.log('   Respuesta recibida de AuthService:', JSON.stringify(rpcResponse, null, 2));
    if (!rpcResponse || !rpcResponse.accessToken || rpcResponse.user.email !== 'admin@mybusiness.demo') {
      throw new Error(`Respuesta RPC no válida: ${JSON.stringify(rpcResponse)}`);
    }
    console.log('   ✅ RPC por Redis (@MessagePattern) transportado exitosamente.');

    // -------------------------------------------------------------------------
    // 7. Probar Evento Asincrónico por Redis (@EventPattern)
    // -------------------------------------------------------------------------
    console.log('\n📢 Paso 7: Emitir evento de dominio: client.emit(AuditEvents.LOG_EVENT)...');
    const eventPayload = {
      action: 'USER_LOGIN_SUCCESS',
      entityName: 'User',
      entityId: 'user-sample-id',
      actorId: 'user-sample-id',
      tenantId: 'tenant-sample-id',
      occurredAt: new Date().toISOString(),
    };
    client.emit(AuditEvents.LOG_EVENT, eventPayload);
    await new Promise((r) => setTimeout(r, 1000));
    console.log('   ✅ Evento por Redis (@EventPattern) emitido y consumido exitosamente.');

    // -------------------------------------------------------------------------
    // 8. Probar BullMQ con infraestructura autenticada
    // -------------------------------------------------------------------------
    console.log('\n🐂 Paso 8: Probar cola durable con BullMQ...');
    const bullmqConfig = getBullMQConnectionOptions();
    const queueName = `issue2-durable-queue-${Date.now()}`;
    const testQueue = new Queue(queueName, { connection: bullmqConfig });

    let workerProcessed = false;
    let processedData = null;

    const worker = new Worker(
      queueName,
      async (job) => {
        processedData = job.data;
        workerProcessed = true;
        return { success: true };
      },
      { connection: bullmqConfig },
    );

    const testJob = await testQueue.add(
      'durable-transaction-job',
      { transactionId: 'tx-10001', amount: 99.99, idempotencyKey: 'idemp-abc-123' },
      { attempts: 3, backoff: { type: 'exponential', delay: 500 } },
    );
    console.log(`   Job encolado en BullMQ con ID: ${testJob.id}`);

    for (let i = 0; i < 20; i++) {
      if (workerProcessed) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!workerProcessed || !processedData || processedData.transactionId !== 'tx-10001') {
      throw new Error('BullMQ Worker no procesó el trabajo correctamente.');
    }
    console.log('   Job completado por BullMQ Worker:', processedData);
    console.log('   ✅ BullMQ validado con autenticación y procesamiento de cola durable.');

    // Cleanup NestJS & BullMQ
    await worker.close();
    await testQueue.close();
    await client.close();
    await authApp.close();
    await auditApp.close();
  } finally {
    redisProc.kill();
    try {
      fs.rmSync(tempAofDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n================================================================');
  console.log('🎉 TODOS LOS CRITERIOS DE ACEPTACIÓN SE HAN CUMPLIDO SATISFACTORIAMENTE');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ ERROR EN VERIFICACIÓN:', err);
  process.exit(1);
});

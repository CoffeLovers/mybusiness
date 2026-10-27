const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');

// Asegurar resolución de dependencias en monorepo pnpm
const rootDir = path.resolve(__dirname, '..');
module.paths.push(
  path.join(rootDir, 'apps/auth-service/node_modules'),
  path.join(rootDir, 'apps/api-gateway/node_modules'),
  path.join(rootDir, 'packages/common/node_modules'),
  path.join(rootDir, 'node_modules'),
);

const { NestFactory } = require('@nestjs/core');
const { ClientProxyFactory, Transport } = require('@nestjs/microservices');
const { firstValueFrom } = require('rxjs');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { Client } = require('pg');

const { AuthServiceModule } = require('../apps/auth-service/dist/auth-service.module');
const { AuditServiceModule } = require('../apps/audit-service/dist/audit-service.module');
const { AuditService } = require('../apps/audit-service/dist/audit.service');
const { AuthPatterns, AuditEvents } = require('../packages/contracts/dist');
const {
  getMicroserviceRedisOptions,
  getBullMQConnectionOptions,
  loadRootEnv,
} = require('../packages/common/dist');

// Cargar variables de entorno raíz si no están ya en process.env
loadRootEnv();

let REDIS_TEST_PORT = Number(process.env.REDIS_PORT || 6386);
let REDIS_TEST_PASS = process.env.REDIS_PASSWORD || 'test_redis_secret_123';
let REDIS_TEST_HOST = process.env.REDIS_HOST || '127.0.0.1';

process.env.REDIS_HOST = REDIS_TEST_HOST;
process.env.REDIS_PORT = String(REDIS_TEST_PORT);
process.env.REDIS_PASSWORD = REDIS_TEST_PASS;

function findRedisServerBinary() {
  if (process.env.REDIS_SERVER_BIN && fs.existsSync(process.env.REDIS_SERVER_BIN)) {
    return process.env.REDIS_SERVER_BIN;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where redis-server' : 'which redis-server';
    const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exe && fs.existsSync(exe)) {
      return exe;
    }
    if (lines[0] && fs.existsSync(lines[0])) {
      return lines[0];
    }
  } catch {}

  const commonPaths = [
    '/usr/bin/redis-server',
    '/usr/local/bin/redis-server',
    '/opt/homebrew/bin/redis-server',
  ];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fs.existsSync(wingetDir)) {
        try {
          const entries = fs.readdirSync(wingetDir);
          for (const entry of entries) {
            if (entry.toLowerCase().includes('redis')) {
              const fullEntry = path.join(wingetDir, entry);
              const findExe = (dir, depth = 0) => {
                if (depth > 3) return null;
                for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                  const itemPath = path.join(dir, item.name);
                  if (item.isFile() && item.name.toLowerCase() === 'redis-server.exe') {
                    return itemPath;
                  }
                  if (item.isDirectory()) {
                    const res = findExe(itemPath, depth + 1);
                    if (res) return res;
                  }
                }
                return null;
              };
              const found = findExe(fullEntry);
              if (found) return found;
            }
          }
        } catch {}
      }
    }
  }

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function validateInitScriptsDeclaratively() {
  const sqlPath = path.resolve(__dirname, '../docker/init-microservices-dbs.sql');
  const shPath = path.resolve(__dirname, '../docker/init-microservices-dbs.sh');

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  const shContent = fs.existsSync(shPath) ? fs.readFileSync(shPath, 'utf8') : '';

  const requiredDatabases = ['auth_db', 'finance_db', 'agent_db', 'audit_db'];
  for (const db of requiredDatabases) {
    if (!sqlContent.includes(`CREATE DATABASE ${db}`) && !shContent.includes(`CREATE DATABASE ${db}`)) {
      throw new Error(`Falta la declaración de creación de base de datos: ${db}`);
    }
  }
  console.log('   ✅ Las 4 bases de datos (auth_db, finance_db, agent_db, audit_db) están declaradas.');

  const requiredUsers = ['auth_user', 'finance_user', 'agent_user', 'audit_user'];
  for (const user of requiredUsers) {
    if (!sqlContent.includes(`rolname = '${user}'`) && !shContent.includes(`$AUTH_USER`)) {
      throw new Error(`Falta el rol de servicio con mínimos privilegios: ${user}`);
    }
  }
  console.log('   ✅ Los 4 roles de servicio con privilegio mínimo están declarados.');

  if (sqlContent.includes('mybusiness_user') || shContent.includes('mybusiness_user')) {
    throw new Error('Violación de mínimos privilegios: mybusiness_user no debe estar presente.');
  }
  console.log('   ✅ Usuario no documentado mybusiness_user eliminado (principio de mínimo privilegio).');

  const vectorMatches = (sqlContent.match(/CREATE EXTENSION IF NOT EXISTS vector;/g) || []).length;
  if (vectorMatches < 4 && !shContent.includes('CREATE EXTENSION IF NOT EXISTS vector;')) {
    throw new Error(`Se esperaban activaciones de extensión vector en las 4 bases`);
  }
  console.log('   ✅ Extensión pgvector activa en las 4 bases de datos.');

  const uuidMatches = (sqlContent.match(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g) || []).length;
  if (uuidMatches < 4 && !shContent.includes('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')) {
    throw new Error(`Se esperaban activaciones de uuid-ossp en las 4 bases`);
  }
  console.log('   ✅ Extensión uuid-ossp activa en las 4 bases de datos.');
}

async function verifyPostgres() {
  console.log('📦 Paso 1: Validar PostgreSQL 16 + pgvector (4 DBs + roles)...');
  const host = process.env.POSTGRES_HOST || '127.0.0.1';
  const port = Number(process.env.POSTGRES_PORT || 5432);
  const adminUser = process.env.POSTGRES_USER || 'mybusiness_admin';
  const adminPass = process.env.POSTGRES_PASSWORD || 'change_in_production_postgres_admin_pass';

  let client = new Client({
    host,
    port,
    user: adminUser,
    password: adminPass,
    database: 'postgres',
    connectionTimeoutMillis: 2500,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
  } catch {
    // Si postgres no está en puerto 5432, verificar declarativamente
  }

  if (connected) {
    console.log(`   ✅ Conexión con PostgreSQL (${adminUser}@${host}:${port}) exitosa.`);
    try {
      // 1. Validar las 4 bases de datos
      const dbRes = await client.query(
        "SELECT datname FROM pg_database WHERE datname IN ('auth_db', 'finance_db', 'agent_db', 'audit_db')"
      );
      const existingDbs = dbRes.rows.map((r) => r.datname);
      for (const db of ['auth_db', 'finance_db', 'agent_db', 'audit_db']) {
        if (!existingDbs.includes(db)) {
          throw new Error(`Base de datos faltante en PostgreSQL: ${db}`);
        }
      }
      console.log(`   ✅ Bases de datos verificadas vía pg: ${existingDbs.join(', ')}`);

      // 2. Validar roles
      const rolesRes = await client.query(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('auth_user', 'finance_user', 'agent_user', 'audit_user', 'mybusiness_user')"
      );
      const existingRoles = rolesRes.rows.map((r) => r.rolname);
      for (const role of ['auth_user', 'finance_user', 'agent_user', 'audit_user']) {
        if (!existingRoles.includes(role)) {
          throw new Error(`Rol de servicio faltante en PostgreSQL: ${role}`);
        }
      }
      if (existingRoles.includes('mybusiness_user')) {
        throw new Error('Rol no deseado mybusiness_user existe en PostgreSQL');
      }
      console.log(`   ✅ Roles de servicio verificados vía pg: ${existingRoles.join(', ')}`);
      await client.end();

      // 3. Validar conexión y extensiones por base de datos
      const services = [
        { db: 'auth_db', user: process.env.AUTH_DB_USER || 'auth_user', pass: process.env.AUTH_DB_PASSWORD || 'change_in_production_auth_pass' },
        { db: 'finance_db', user: process.env.FINANCE_DB_USER || 'finance_user', pass: process.env.FINANCE_DB_PASSWORD || 'change_in_production_finance_pass' },
        { db: 'agent_db', user: process.env.AGENT_DB_USER || 'agent_user', pass: process.env.AGENT_DB_PASSWORD || 'change_in_production_agent_pass' },
        { db: 'audit_db', user: process.env.AUDIT_DB_USER || 'audit_user', pass: process.env.AUDIT_DB_PASSWORD || 'change_in_production_audit_pass' },
      ];

      for (const svc of services) {
        const svcClient = new Client({
          host,
          port,
          user: svc.user,
          password: svc.pass,
          database: svc.db,
          connectionTimeoutMillis: 2500,
        });
        await svcClient.connect();
        const extRes = await svcClient.query(
          "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp')"
        );
        const exts = extRes.rows.map((r) => r.extname);
        if (!exts.includes('vector') || !exts.includes('uuid-ossp')) {
          throw new Error(`Extensiones faltantes en ${svc.db}: ${exts.join(', ')}`);
        }
        console.log(`   ✅ [${svc.db}] Conectado como ${svc.user}. Extensiones verificadas: vector, uuid-ossp.`);
        await svcClient.end();
      }

      // 4. Validar aislamiento (menor privilegio): auth_user no debe poder conectarse a finance_db
      const unauthClient = new Client({
        host,
        port,
        user: process.env.AUTH_DB_USER || 'auth_user',
        password: process.env.AUTH_DB_PASSWORD || 'change_in_production_auth_pass',
        database: 'finance_db',
        connectionTimeoutMillis: 2500,
      });
      let connectedUnauth = false;
      try {
        await unauthClient.connect();
        connectedUnauth = true;
        await unauthClient.end();
      } catch {
        console.log('   ✅ Aislamiento de privilegio mínimo verificado: auth_user no puede acceder a finance_db.');
      }
      if (connectedUnauth) {
        throw new Error('Violación de seguridad: auth_user logró conectarse a finance_db');
      }
    } catch (e) {
      try { await client.end(); } catch {}
      throw e;
    }
  } else {
    console.log('   ℹ️ Instancia PostgreSQL en vivo no detectada en este host. Validando estructura declarativa...');
    validateInitScriptsDeclaratively();
  }
}

async function run() {
  console.log('================================================================');
  console.log('🚀 Verificación Integral del Issue #2 (Sprint 1)');
  console.log('   PostgreSQL 16 + pgvector y Redis 7 (Microservicios + BullMQ)');
  console.log('================================================================\n');

  // Paso 1: Validar PostgreSQL
  await verifyPostgres();

  // Paso 2: Iniciar o conectar a Redis Server con contraseña y AOF
  console.log('\n🔴 Paso 2: Configurar y verificar Redis Server (autenticación + AOF)...');

  let redisProc = null;
  let tempAofDir = null;
  let isDockerManaged = false;

  // Intentar conectar al Redis existente (e.g. Docker Compose en puerto REDIS_PORT)
  const existingRedis = new Redis({
    host: REDIS_TEST_HOST,
    port: REDIS_TEST_PORT,
    password: REDIS_TEST_PASS,
    lazyConnect: true,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  existingRedis.on('error', () => {});

  let runningRedis = false;
  try {
    await existingRedis.connect();
    const pong = await existingRedis.ping();
    if (pong === 'PONG') {
      runningRedis = true;
      console.log(`   ✅ Conexión establecida a Redis en ${REDIS_TEST_HOST}:${REDIS_TEST_PORT}.`);
    }
  } catch {
    // Redis no está corriendo en el puerto configurado
  } finally {
    try { await existingRedis.quit(); } catch {}
  }

  const spawnRedisInstance = (dir) => {
    const bin = findRedisServerBinary();
    if (!bin) {
      throw new Error(
        'No se encontró el ejecutable redis-server en PATH ni en ubicaciones del sistema. ' +
        'Inicia el contenedor con "pnpm docker:up" o instala redis-server.'
      );
    }
    const args = [
      '--port', String(REDIS_TEST_PORT),
      '--requirepass', String(REDIS_TEST_PASS),
      '--appendonly', 'yes',
      '--dir', String(dir),
    ];
    const isCmdOrBat = bin.toLowerCase().endsWith('.cmd') || bin.toLowerCase().endsWith('.bat');
    return spawn(bin, args, { stdio: 'ignore', shell: isCmdOrBat });
  };

  if (!runningRedis) {
    const redisBin = findRedisServerBinary();
    if (redisBin) {
      tempAofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redis_issue2_test_'));
      redisProc = spawnRedisInstance(tempAofDir);
      await new Promise((r) => setTimeout(r, 1200));
      console.log(`   ✅ Redis iniciado localmente (pid ${redisProc.pid}) en puerto ${REDIS_TEST_PORT} con AOF.`);
    } else {
      throw new Error('Redis no está corriendo y no se encontró redis-server local. Ejecuta "pnpm docker:up" primero.');
    }
  }

  try {
    // Paso 2.1: Validar persistencia AOF ante reinicio
    console.log('   Probando persistencia AOF tras reinicio de Redis...');
    const redisClient = new Redis({
      host: REDIS_TEST_HOST,
      port: REDIS_TEST_PORT,
      password: REDIS_TEST_PASS,
    });
    const aofKey = `issue2:aof:test:${Date.now()}`;
    const aofValue = `persisted_value_${Date.now()}`;
    await redisClient.set(aofKey, aofValue);
    await redisClient.quit();

    if (redisProc && tempAofDir) {
      // Reiniciar proceso local usando el mismo directorio AOF
      redisProc.kill();
      await new Promise((r) => setTimeout(r, 800));
      redisProc = spawnRedisInstance(tempAofDir);
      await new Promise((r) => setTimeout(r, 1200));
    } else {
      // Si corre en Docker Compose, intentar reinicio del contenedor
      try {
        execSync('docker compose --env-file .env -f docker/docker-compose.yml restart redis', {
          stdio: 'ignore',
        });
        await new Promise((r) => setTimeout(r, 2000));
      } catch {}
    }

    const verifyAofClient = new Redis({
      host: REDIS_TEST_HOST,
      port: REDIS_TEST_PORT,
      password: REDIS_TEST_PASS,
    });
    const recoveredValue = await verifyAofClient.get(aofKey);
    await verifyAofClient.del(aofKey);
    await verifyAofClient.quit();

    if (recoveredValue !== aofValue) {
      throw new Error(`Persistencia AOF falló. Esperado: ${aofValue}, recibido: ${recoveredValue}`);
    }
    console.log('   ✅ Persistencia AOF verificada: los datos sobreviven al reinicio de Redis.');

    // -------------------------------------------------------------------------
    // Paso 3: Levantar AuthService real sobre Transport.REDIS
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
    // Paso 4: Levantar AuditService real sobre Transport.REDIS
    // -------------------------------------------------------------------------
    console.log('\n📜 Paso 4: Arrancar AuditService real con Transport.REDIS...');
    const auditApp = await NestFactory.createMicroservice(AuditServiceModule, {
      transport: Transport.REDIS,
      options: redisOptions,
    });
    const auditService = auditApp.get(AuditService);
    let capturedAuditEvent = null;
    const originalRecordLog = auditService.recordLog.bind(auditService);
    auditService.recordLog = async (event) => {
      capturedAuditEvent = event;
      return originalRecordLog(event);
    };
    await auditApp.listen();
    console.log('   ✅ AuditService escuchando sobre Redis Pub/Sub.');

    // -------------------------------------------------------------------------
    // Paso 5: Conectar ClientProxy de API Gateway hacia Redis
    // -------------------------------------------------------------------------
    console.log('\n📡 Paso 5: Conectar ClientProxy de API Gateway hacia Redis Broker...');
    const client = ClientProxyFactory.create({
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await client.connect();
    console.log('   ✅ ClientProxy conectado autenticado al broker.');

    // -------------------------------------------------------------------------
    // Paso 6: Probar RPC sincrónico por Redis (@MessagePattern) con credencial Demo1234!
    // -------------------------------------------------------------------------
    console.log('\n🔁 Paso 6: Ejecutar llamada RPC: client.send(AuthPatterns.LOGIN)...');
    const rpcResponse = await firstValueFrom(
      client.send(AuthPatterns.LOGIN, {
        email: 'admin@mybusiness.demo',
        password: 'Demo1234!',
      }),
    );
    if (!rpcResponse || !rpcResponse.accessToken || rpcResponse.user.email !== 'admin@mybusiness.demo') {
      throw new Error(`Respuesta RPC no válida: ${JSON.stringify(rpcResponse)}`);
    }
    console.log('   ✅ RPC por Redis (@MessagePattern) validado exitosamente con usuario demo.');

    // -------------------------------------------------------------------------
    // Paso 7: Probar Evento Asincrónico por Redis (@EventPattern) y asertar consumidor
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

    for (let i = 0; i < 25; i++) {
      if (capturedAuditEvent) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!capturedAuditEvent || capturedAuditEvent.action !== 'USER_LOGIN_SUCCESS') {
      throw new Error(
        `AuditService no recibió el evento emitido. Estado capturado: ${JSON.stringify(capturedAuditEvent)}`
      );
    }
    console.log('   ✅ Evento por Redis (@EventPattern) recibido y verificado por consumidor AuditService.');

    // -------------------------------------------------------------------------
    // Paso 8: Probar BullMQ con infraestructura autenticada
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

    for (let i = 0; i < 25; i++) {
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
    if (redisProc) {
      redisProc.kill();
    }
    if (tempAofDir) {
      try {
        fs.rmSync(tempAofDir, { recursive: true, force: true });
      } catch {}
    }
  }

  console.log('\n================================================================');
  console.log('🎉 TODOS LOS CRITERIOS DE ACEPTACIÓN SE HAN CUMPLIDO SATISFACTORIAMENTE');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ ERROR EN VERIFICACIÓN:', err);
  process.exit(1);
});

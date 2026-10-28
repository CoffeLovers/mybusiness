const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

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
const { firstValueFrom, timeout } = require('rxjs');
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

const REDIS_TEST_PORT = Number(process.env.REDIS_PORT || 6386);
const REDIS_TEST_PASS = process.env.REDIS_PASSWORD;
const REDIS_TEST_HOST = process.env.REDIS_HOST || '127.0.0.1';
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

process.env.REDIS_HOST = REDIS_TEST_HOST;
process.env.REDIS_PORT = String(REDIS_TEST_PORT);
if (REDIS_TEST_PASS) {
  process.env.REDIS_PASSWORD = REDIS_TEST_PASS;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findRedisServerBinary() {
  if (process.env.REDIS_SERVER_BIN && fs.existsSync(process.env.REDIS_SERVER_BIN)) {
    return process.env.REDIS_SERVER_BIN;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where redis-server' : 'which redis-server';
    const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
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
  const shPath = path.resolve(__dirname, '../docker/init-microservices-dbs.sh');

  if (!fs.existsSync(shPath)) {
    throw new Error(`No existe el script de inicialización: ${shPath}`);
  }

  const stat = fs.statSync(shPath);
  if ((stat.mode & 0o111) === 0) {
    throw new Error('docker/init-microservices-dbs.sh debe ser ejecutable (chmod +x).');
  }

  const shContent = fs.readFileSync(shPath, 'utf8');

  const requiredDatabases = ['auth_db', 'finance_db', 'agent_db', 'audit_db'];
  for (const db of requiredDatabases) {
    if (!shContent.includes(`'${db}'`)) {
      throw new Error(`Falta la declaración de creación de base de datos: ${db}`);
    }
  }
  console.log(
    '   ✅ Las 4 bases de datos (auth_db, finance_db, agent_db, audit_db) están declaradas.',
  );

  const requiredRoles = [
    ['AUTH_DB_USER', 'AUTH_USER'],
    ['FINANCE_DB_USER', 'FINANCE_USER'],
    ['AGENT_DB_USER', 'AGENT_USER'],
    ['AUDIT_DB_USER', 'AUDIT_USER'],
  ];
  for (const [envVar, shellVar] of requiredRoles) {
    if (!shContent.includes(envVar) || !shContent.includes(shellVar)) {
      throw new Error(`Falta el rol de servicio con mínimos privilegios: ${envVar}`);
    }
  }
  console.log('   ✅ Los 4 roles de servicio con privilegio mínimo están declarados.');

  if (/CREATE\s+ROLE\s+mybusiness_user/i.test(shContent)) {
    throw new Error('Violación de mínimos privilegios: mybusiness_user no debe crearse.');
  }
  if (!/DROP\s+ROLE\s+IF\s+EXISTS\s+mybusiness_user/i.test(shContent)) {
    throw new Error('Falta la limpieza del rol legacy mybusiness_user.');
  }
  if (/PASSWORD\s+'/i.test(shContent)) {
    throw new Error('El script no debe interpolar contraseñas directamente en SQL.');
  }
  if (shContent.includes('change_in_production')) {
    throw new Error('El script no debe contener contraseñas por defecto.');
  }
  console.log(
    '   ✅ Rol legacy mybusiness_user con limpieza declarada y sin contraseñas embebidas.',
  );

  const configureCalls = (shContent.match(/configure_db\s+"/g) || []).length;
  if (!shContent.includes('CREATE EXTENSION IF NOT EXISTS vector;') || configureCalls < 4) {
    throw new Error(`Se esperaban activaciones de extensión vector en las 4 bases`);
  }
  console.log('   ✅ Extensión pgvector activa en las 4 bases de datos.');

  if (!shContent.includes('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";') || configureCalls < 4) {
    throw new Error(`Se esperaban activaciones de uuid-ossp en las 4 bases`);
  }
  console.log('   ✅ Extensión uuid-ossp activa en las 4 bases de datos.');
}

function validateEnvConsistency() {
  const expectedPort = String(process.env.POSTGRES_PORT || '5432');
  if (!/^\d+$/.test(expectedPort)) {
    throw new Error(`POSTGRES_PORT inválido: ${expectedPort}`);
  }

  const urls = [
    ['AUTH_DATABASE_URL', 'AUTH_DB_USER'],
    ['FINANCE_DATABASE_URL', 'FINANCE_DB_USER'],
    ['AGENT_DATABASE_URL', 'AGENT_DB_USER'],
    ['AUDIT_DATABASE_URL', 'AUDIT_DB_USER'],
  ];

  for (const [urlKey, userKey] of urls) {
    const rawUrl = process.env[urlKey];
    if (!rawUrl) continue;

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`${urlKey} no es una URL válida.`);
    }

    const urlPort = parsed.port || '5432';
    if (urlPort !== expectedPort) {
      throw new Error(
        `${urlKey} usa el puerto ${urlPort}, pero POSTGRES_PORT=${expectedPort}. ` +
          'Actualiza las URLs o el puerto para que coincidan.',
      );
    }

    const expectedUser = process.env[userKey];
    if (expectedUser && decodeURIComponent(parsed.username) !== expectedUser) {
      throw new Error(
        `${urlKey} usa el usuario ${parsed.username}, pero ${userKey}=${expectedUser}.`,
      );
    }
  }
}

async function verifyPostgres() {
  console.log('📦 Paso 1: Validar PostgreSQL 16 + pgvector (4 DBs + roles)...');

  validateInitScriptsDeclaratively();
  validateEnvConsistency();

  const host = process.env.POSTGRES_HOST || '127.0.0.1';
  const port = Number(process.env.POSTGRES_PORT || 5432);
  const adminUser = process.env.POSTGRES_USER || 'mybusiness_admin';
  const adminPass = process.env.POSTGRES_PASSWORD;

  if (!adminPass) {
    throw new Error(
      'POSTGRES_PASSWORD es obligatorio para ejecutar la verificación de PostgreSQL.',
    );
  }

  for (const key of [
    'AUTH_DB_PASSWORD',
    'FINANCE_DB_PASSWORD',
    'AGENT_DB_PASSWORD',
    'AUDIT_DB_PASSWORD',
  ]) {
    if (!process.env[key]) {
      throw new Error(`${key} es obligatorio para ejecutar la verificación de PostgreSQL.`);
    }
  }

  const client = new Client({
    host,
    port,
    user: adminUser,
    password: adminPass,
    database: 'postgres',
    connectionTimeoutMillis: 2500,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${host}:${port} como ${adminUser}. ` +
        `Ejecuta "pnpm docker:up" y verifica .env. Causa: ${error.message}`,
    );
  }

  console.log(`   ✅ Conexión con PostgreSQL (${adminUser}@${host}:${port}) exitosa.`);

  try {
    const dbRes = await client.query(
      "SELECT datname FROM pg_database WHERE datname IN ('auth_db', 'finance_db', 'agent_db', 'audit_db')",
    );
    const existingDbs = dbRes.rows.map((r) => r.datname);
    for (const db of ['auth_db', 'finance_db', 'agent_db', 'audit_db']) {
      if (!existingDbs.includes(db)) {
        throw new Error(`Base de datos faltante en PostgreSQL: ${db}`);
      }
    }
    console.log(`   ✅ Bases de datos verificadas vía pg: ${existingDbs.join(', ')}`);

    const rolesRes = await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('auth_user', 'finance_user', 'agent_user', 'audit_user', 'mybusiness_user')",
    );
    const existingRoles = rolesRes.rows.map((r) => r.rolname);
    for (const role of ['auth_user', 'finance_user', 'agent_user', 'audit_user']) {
      if (!existingRoles.includes(role)) {
        throw new Error(`Rol de servicio faltante en PostgreSQL: ${role}`);
      }
    }
    if (existingRoles.includes('mybusiness_user')) {
      throw new Error(
        'Rol no deseado mybusiness_user existe en PostgreSQL. ' +
          'Ejecuta el script de inicialización para limpiar el volumen existente.',
      );
    }
    console.log(`   ✅ Roles de servicio verificados vía pg: ${existingRoles.join(', ')}`);

    const services = [
      {
        db: 'auth_db',
        user: process.env.AUTH_DB_USER || 'auth_user',
        pass: process.env.AUTH_DB_PASSWORD,
      },
      {
        db: 'finance_db',
        user: process.env.FINANCE_DB_USER || 'finance_user',
        pass: process.env.FINANCE_DB_PASSWORD,
      },
      {
        db: 'agent_db',
        user: process.env.AGENT_DB_USER || 'agent_user',
        pass: process.env.AGENT_DB_PASSWORD,
      },
      {
        db: 'audit_db',
        user: process.env.AUDIT_DB_USER || 'audit_user',
        pass: process.env.AUDIT_DB_PASSWORD,
      },
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
      try {
        await svcClient.connect();
        const extRes = await svcClient.query(
          "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp')",
        );
        const exts = extRes.rows.map((r) => r.extname);
        if (!exts.includes('vector') || !exts.includes('uuid-ossp')) {
          throw new Error(`Extensiones faltantes en ${svc.db}: ${exts.join(', ')}`);
        }
        console.log(
          `   ✅ [${svc.db}] Conectado como ${svc.user}. Extensiones verificadas: vector, uuid-ossp.`,
        );
      } finally {
        await svcClient.end().catch(() => {});
      }
    }

    const unauthClient = new Client({
      host,
      port,
      user: process.env.AUTH_DB_USER || 'auth_user',
      password: process.env.AUTH_DB_PASSWORD,
      database: 'finance_db',
      connectionTimeoutMillis: 2500,
    });
    let connectedUnauth = false;
    try {
      await unauthClient.connect();
      connectedUnauth = true;
    } catch {
      console.log(
        '   ✅ Aislamiento de privilegio mínimo verificado: auth_user no puede acceder a finance_db.',
      );
    } finally {
      if (connectedUnauth) {
        await unauthClient.end().catch(() => {});
      }
    }
    if (connectedUnauth) {
      throw new Error('Violación de seguridad: auth_user logró conectarse a finance_db');
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitForRedis(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    const probe = new Redis({
      host: REDIS_TEST_HOST,
      port: REDIS_TEST_PORT,
      password: REDIS_TEST_PASS,
      lazyConnect: true,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    probe.on('error', () => {});
    try {
      await probe.connect();
      const pong = await probe.ping();
      if (pong === 'PONG') {
        return;
      }
    } catch (error) {
      lastError = error;
    } finally {
      try {
        await probe.quit();
      } catch {}
    }
    await sleep(300);
  }

  throw new Error(
    `Redis no respondió en ${REDIS_TEST_HOST}:${REDIS_TEST_PORT} tras ${timeoutMs}ms. ` +
      `Último error: ${lastError?.message || 'desconocido'}`,
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function run() {
  console.log('================================================================');
  console.log('🚀 Verificación Integral del Issue #2 (Sprint 1)');
  console.log('   PostgreSQL 16 + pgvector y Redis 7 (Microservicios + BullMQ)');
  console.log('================================================================\n');

  if (!REDIS_TEST_PASS) {
    throw new Error(
      'REDIS_PASSWORD es obligatorio para ejecutar la verificación. Copia .env.example a .env.',
    );
  }
  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD son obligatorios para verificar el login demo.',
    );
  }
  if (!Number.isInteger(REDIS_TEST_PORT) || REDIS_TEST_PORT <= 0) {
    throw new Error(`REDIS_PORT inválido: ${process.env.REDIS_PORT}`);
  }

  await verifyPostgres();

  console.log('\n🧱 Paso 1b: Aplicar esquema y seed de Auth para probar login real...');
  execSync('pnpm --filter @mybusiness/auth-service db:migrate', {
    cwd: rootDir,
    stdio: 'inherit',
  });
  execSync('pnpm --filter @mybusiness/auth-service db:seed', {
    cwd: rootDir,
    stdio: 'inherit',
  });
  console.log('   ✅ Esquema y usuario de prueba disponibles para la verificación RPC.');

  console.log('\n🔴 Paso 2: Configurar y verificar Redis Server (autenticación + AOF)...');

  let redisProc = null;
  let tempAofDir = null;

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
      const config = await existingRedis.config('GET', 'appendonly');
      const aofValue = Array.isArray(config) ? config[1] : String(config).split(/\s+/).pop();
      if (String(aofValue).toLowerCase() !== 'yes') {
        throw new Error(
          `Redis en ${REDIS_TEST_HOST}:${REDIS_TEST_PORT} no tiene AOF habilitado (appendonly=${aofValue}).`,
        );
      }
      console.log(
        `   ✅ Conexión establecida a Redis en ${REDIS_TEST_HOST}:${REDIS_TEST_PORT} con AOF.`,
      );
    }
  } catch (error) {
    if (runningRedis) throw error;
  } finally {
    try {
      await existingRedis.quit();
    } catch {}
  }

  const spawnRedisInstance = (dir) => {
    const bin = findRedisServerBinary();
    if (!bin) {
      throw new Error(
        'No se encontró el ejecutable redis-server en PATH ni en ubicaciones del sistema. ' +
          'Inicia el contenedor con "pnpm docker:up" o instala redis-server.',
      );
    }
    const args = [
      '--port',
      String(REDIS_TEST_PORT),
      '--requirepass',
      String(REDIS_TEST_PASS),
      '--appendonly',
      'yes',
      '--appendfsync',
      'always',
      '--dir',
      String(dir),
    ];
    const isCmdOrBat = bin.toLowerCase().endsWith('.cmd') || bin.toLowerCase().endsWith('.bat');
    return spawn(bin, args, { stdio: 'ignore', shell: isCmdOrBat });
  };

  if (!runningRedis) {
    const redisBin = findRedisServerBinary();
    if (redisBin) {
      tempAofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redis_issue2_test_'));
      redisProc = spawnRedisInstance(tempAofDir);
      await waitForRedis();
      console.log(
        `   ✅ Redis iniciado localmente (pid ${redisProc.pid}) en puerto ${REDIS_TEST_PORT} con AOF.`,
      );
    } else {
      throw new Error(
        'Redis no está corriendo y no se encontró redis-server local. Ejecuta "pnpm docker:up" primero.',
      );
    }
  }

  let authApp;
  let auditApp;
  let client;
  let testQueue;
  let worker;

  try {
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
      await stopChild(redisProc);
      await sleep(300);
      redisProc = spawnRedisInstance(tempAofDir);
      await waitForRedis();
    } else {
      try {
        execSync('docker compose --env-file .env -f docker/docker-compose.yml restart redis', {
          cwd: rootDir,
          stdio: 'pipe',
        });
      } catch (error) {
        const stderr = error.stderr ? error.stderr.toString().trim() : '';
        throw new Error(
          'No se pudo reiniciar el Redis de Docker Compose para validar AOF. ' +
            'Este test exige que el Redis en ' +
            `${REDIS_TEST_HOST}:${REDIS_TEST_PORT} sea el servicio "redis" de docker-compose.yml. ` +
            `Detén cualquier Redis local en ese puerto o levanta la infraestructura con "pnpm docker:up". ` +
            `Causa: ${stderr || error.message}`,
        );
      }
      await waitForRedis();
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

    console.log('\n⚡ Paso 3: Arrancar AuthService real con Transport.REDIS...');
    const redisOptions = getMicroserviceRedisOptions();
    authApp = await NestFactory.createMicroservice(AuthServiceModule, {
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await authApp.listen();
    console.log('   ✅ AuthService escuchando sobre Redis Pub/Sub.');

    console.log('\n📜 Paso 4: Arrancar AuditService real con Transport.REDIS...');
    auditApp = await NestFactory.createMicroservice(AuditServiceModule, {
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

    console.log('\n📡 Paso 5: Conectar ClientProxy de API Gateway hacia Redis Broker...');
    client = ClientProxyFactory.create({
      transport: Transport.REDIS,
      options: redisOptions,
    });
    await client.connect();
    console.log('   ✅ ClientProxy conectado autenticado al broker.');

    console.log('\n🔁 Paso 6: Ejecutar llamada RPC: client.send(AuthPatterns.LOGIN)...');
    const rpcResponse = await firstValueFrom(
      client.send(AuthPatterns.LOGIN, {
        email: SEED_ADMIN_EMAIL,
        password: SEED_ADMIN_PASSWORD,
      }),
    );
    if (!rpcResponse || !rpcResponse.accessToken || rpcResponse.user.email !== SEED_ADMIN_EMAIL) {
      throw new Error(`Respuesta RPC no válida: ${JSON.stringify(rpcResponse)}`);
    }
    console.log('   ✅ RPC por Redis (@MessagePattern) validado exitosamente con usuario demo.');

    console.log('\n🔄 Paso 6b: Rotar Refresh Token y verificar detección de reuso...');
    if (!rpcResponse.refreshToken) {
      throw new Error('El login no devolvió un Refresh Token para probar la rotación.');
    }

    const refreshed = await firstValueFrom(
      client
        .send(AuthPatterns.REFRESH, { refreshToken: rpcResponse.refreshToken })
        .pipe(timeout(5000)),
    );

    if (!refreshed?.accessToken || refreshed.refreshToken === rpcResponse.refreshToken) {
      throw new Error(`Rotación de Refresh Token no válida: ${JSON.stringify(refreshed)}`);
    }

    let reuseRejected = false;
    try {
      await firstValueFrom(
        client
          .send(AuthPatterns.REFRESH, { refreshToken: rpcResponse.refreshToken })
          .pipe(timeout(5000)),
      );
    } catch {
      reuseRejected = true;
    }

    if (!reuseRejected) {
      throw new Error('El reuso de un Refresh Token revocado no fue rechazado.');
    }

    console.log('   ✅ Rotación estricta y detección de reuso verificadas contra PostgreSQL.');

    console.log('\n📢 Paso 7: Emitir evento de dominio: client.emit(AuditEvents.LOG_EVENT)...');
    const eventEntityId = randomUUID();
    const eventTenantId = randomUUID();
    const eventPayload = {
      action: 'USER_LOGIN_SUCCESS',
      entityName: 'User',
      entityId: eventEntityId,
      actorId: eventEntityId,
      tenantId: eventTenantId,
      occurredAt: new Date().toISOString(),
    };
    client.emit(AuditEvents.LOG_EVENT, eventPayload);

    for (let i = 0; i < 25; i++) {
      if (capturedAuditEvent) break;
      await sleep(200);
    }

    if (!capturedAuditEvent || capturedAuditEvent.action !== eventPayload.action) {
      throw new Error(
        `AuditService no recibió el evento emitido. Estado capturado: ${JSON.stringify(capturedAuditEvent)}`,
      );
    }
    console.log(
      '   ✅ Evento por Redis (@EventPattern) recibido y verificado por consumidor AuditService.',
    );

    console.log('\n🐂 Paso 8: Probar cola durable con BullMQ...');
    const bullmqConfig = getBullMQConnectionOptions();
    const queueName = `issue2-durable-queue-${Date.now()}`;
    testQueue = new Queue(queueName, { connection: bullmqConfig });

    let workerProcessed = false;
    let processedData = null;

    worker = new Worker(
      queueName,
      async (job) => {
        processedData = job.data;
        workerProcessed = true;
        return { success: true };
      },
      { connection: bullmqConfig },
    );

    const testTransaction = {
      transactionId: randomUUID(),
      amountMinor: '9999',
      currency: 'COP',
      idempotencyKey: randomUUID(),
    };
    const testJob = await testQueue.add('durable-transaction-job', testTransaction, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 500 },
    });
    console.log(`   Job encolado en BullMQ con ID: ${testJob.id}`);

    for (let i = 0; i < 25; i++) {
      if (workerProcessed) break;
      await sleep(200);
    }

    if (
      !workerProcessed ||
      !processedData ||
      processedData.transactionId !== testTransaction.transactionId
    ) {
      throw new Error('BullMQ Worker no procesó el trabajo correctamente.');
    }
    console.log('   Job completado por BullMQ Worker:', processedData);
    console.log('   ✅ BullMQ validado con autenticación y procesamiento de cola durable.');
  } finally {
    if (worker) await worker.close().catch(() => {});
    if (testQueue) await testQueue.close().catch(() => {});
    if (client) await client.close().catch(() => {});
    if (authApp) await authApp.close().catch(() => {});
    if (auditApp) await auditApp.close().catch(() => {});
    if (redisProc) await stopChild(redisProc);
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

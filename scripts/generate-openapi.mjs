/**
 * Script determinista de generación de especificación OpenAPI para MyBusiness API Gateway.
 *
 * Características:
 * - Bootstrapea AppModule sin conexiones activas a base de datos ni Redis.
 * - Enriquece los DTOs de @mybusiness/contracts dinámicamente con metadatos Swagger
 *   a partir de class-validator y reflect-metadata.
 * - Registra los modelos de respuesta canónicos de auth, banking, finance, ledger y reconciliation.
 * - Excluye endpoints internos de health para mantener el contrato enfocado en el dominio.
 * - Ordena recursivamente las claves para garantizar reproducibilidad byte a byte.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// 1. Variables de entorno dummy para bootstrap sin servicios externos
//    REDIS_PASSWORD es requerida por getRedisConfig() en @mybusiness/common y falla de forma
//    temprana si no existe. En CI no hay archivo .env, por lo que se debe asignar aquí
//    un valor dummy que no se usará para ninguna conexión real (el bootstrap es estático).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy_jwt_secret_for_contract_generation_32_chars_long';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'mybusiness';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mybusiness-api';
process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'dummy_redis_password_for_contract_generation';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:3000';
process.env.TRUST_PROXY_HOPS = process.env.TRUST_PROXY_HOPS || '1';
process.env.NODE_ENV = 'test';

// 2. Carga de dependencias reflect-metadata y Nest/Swagger
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

require(resolve(rootDir, 'apps/api-gateway/node_modules/reflect-metadata'));

const { NestFactory } = require(resolve(rootDir, 'apps/api-gateway/node_modules/@nestjs/core'));
const { SwaggerModule, DocumentBuilder, ApiProperty } = require(resolve(rootDir, 'apps/api-gateway/node_modules/@nestjs/swagger'));
const { getMetadataStorage } = require(resolve(rootDir, 'apps/api-gateway/node_modules/class-validator'));
const contracts = require(resolve(rootDir, 'packages/contracts/dist/index.js'));

// 3. Enriquecer DTOs de @mybusiness/contracts con decoradores Swagger
function enrichDtoMetadata() {
  const metadataStorage = getMetadataStorage();

  for (const [exportName, exportedItem] of Object.entries(contracts)) {
    if (typeof exportedItem !== 'function' || !exportedItem.prototype) {
      continue;
    }

    const metadatas = metadataStorage.getTargetValidationMetadatas(exportedItem, '', false, false);
    if (!metadatas || metadatas.length === 0) {
      continue;
    }

    const propMap = new Map();
    for (const meta of metadatas) {
      if (!propMap.has(meta.propertyName)) {
        propMap.set(meta.propertyName, []);
      }
      propMap.get(meta.propertyName).push(meta);
    }

    for (const [propName, validations] of propMap.entries()) {
      const isOptional = validations.some((v) => v.type === 'conditionalValidation' || v.name === 'isOptional');
      const enumVal = validations.find((v) => v.name === 'isEnum');
      const isInVal = validations.find((v) => v.name === 'isIn');

      const reflectedType = Reflect.getMetadata('design:type', exportedItem.prototype, propName);

      let swaggerType = reflectedType || String;
      let enumOptions;

      if (enumVal && enumVal.constraints && enumVal.constraints[0]) {
        enumOptions = enumVal.constraints[0];
      } else if (isInVal && isInVal.constraints && isInVal.constraints[0]) {
        enumOptions = isInVal.constraints[0];
      }

      const isArray = validations.some((v) => v.name === 'isArray');
      const isInt = validations.some((v) => v.name === 'isInt');
      const isNumber = isInt || validations.some((v) => v.name === 'isNumber' || v.name === 'min' || v.name === 'max');
      const isBoolean = validations.some((v) => v.name === 'isBoolean');

      if (isBoolean) {
        swaggerType = Boolean;
      } else if (isNumber) {
        swaggerType = Number;
      } else if (isArray) {
        swaggerType = [String];
      }

      try {
        ApiProperty({
          required: !isOptional,
          type: enumOptions ? undefined : swaggerType,
          enum: enumOptions,
        })(exportedItem.prototype, propName);
      } catch {
        // Ignorar si ya estuviera registrado
      }
    }
  }
}

// 4. Esquemas canónicos complementarios para respuestas y tipos compartidos
const CANONICAL_SCHEMAS = {
  UserDto: {
    type: 'object',
    required: ['id', 'email', 'firstName', 'lastName', 'role', 'tenantId'],
    properties: {
      id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      role: {
        type: 'string',
        enum: ['SUPER_ADMIN', 'TENANT_ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER', 'EMPLOYEE'],
      },
      tenantId: { type: 'string' },
      companyName: { type: 'string', nullable: true },
    },
  },
  AuthResponse: {
    type: 'object',
    required: ['accessToken', 'refreshToken', 'user'],
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      user: { $ref: '#/components/schemas/UserDto' },
    },
  },
  StartBankConnectionResponse: {
    type: 'object',
    required: ['provider'],
    properties: {
      provider: { type: 'string', enum: ['PLAID', 'BELVO'] },
      linkToken: { type: 'string', nullable: true },
      expiration: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  BankConnectionResponse: {
    type: 'object',
    required: ['id', 'provider', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      provider: { type: 'string', enum: ['PLAID', 'BELVO'] },
      institutionId: { type: 'string', nullable: true },
      institutionName: { type: 'string', nullable: true },
      status: {
        type: 'string',
        enum: ['PENDING', 'ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISCONNECTED'],
      },
      lastSuccessfulSyncAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  BankAccountResponse: {
    type: 'object',
    required: ['id', 'connectionId', 'providerAccountId', 'name', 'isoCurrencyCode'],
    properties: {
      id: { type: 'string' },
      connectionId: { type: 'string' },
      providerAccountId: { type: 'string' },
      name: { type: 'string' },
      officialName: { type: 'string', nullable: true },
      type: { type: 'string', nullable: true },
      subtype: { type: 'string', nullable: true },
      mask: { type: 'string', nullable: true },
      isoCurrencyCode: { type: 'string' },
      balanceCurrentMinor: { type: 'string', nullable: true },
      balanceAvailableMinor: { type: 'string', nullable: true },
      status: { type: 'string', nullable: true },
      lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  BankTransactionResponse: {
    type: 'object',
    required: ['id', 'accountId', 'providerTransactionId', 'amountMinor', 'transactionType', 'isoCurrencyCode', 'date', 'name', 'pending'],
    properties: {
      id: { type: 'string' },
      accountId: { type: 'string' },
      providerTransactionId: { type: 'string' },
      amountMinor: { type: 'string' },
      transactionType: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'] },
      isoCurrencyCode: { type: 'string' },
      date: { type: 'string', format: 'date' },
      authorizedDate: { type: 'string', format: 'date', nullable: true },
      name: { type: 'string' },
      merchantName: { type: 'string', nullable: true },
      category: { type: 'array', items: { type: 'string' }, nullable: true },
      pending: { type: 'boolean' },
    },
  },
  SyncConnectionResponse: {
    type: 'object',
    required: ['connectionId', 'added', 'modified', 'removed', 'hasMore'],
    properties: {
      connectionId: { type: 'string' },
      added: { type: 'integer' },
      modified: { type: 'integer' },
      removed: { type: 'integer' },
      hasMore: { type: 'boolean' },
      nextCursor: { type: 'string', nullable: true },
    },
  },
  CashflowSummaryResponse: {
    type: 'object',
    required: ['hasData', 'currency', 'availableCurrencies', 'period', 'series', 'categories'],
    properties: {
      hasData: { type: 'boolean' },
      currency: { type: 'string' },
      availableCurrencies: { type: 'array', items: { type: 'string' } },
      period: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
      balanceMinor: { type: 'string', nullable: true },
      incomeMinor: { type: 'string', nullable: true },
      expenseMinor: { type: 'string', nullable: true },
      burnRateMinor: { type: 'string', nullable: true },
      runwayMonths: { type: 'number', nullable: true },
      previousPeriod: {
        type: 'object',
        nullable: true,
        properties: {
          incomeMinor: { type: 'string' },
          expenseMinor: { type: 'string' },
        },
      },
      series: {
        type: 'array',
        items: {
          type: 'object',
          required: ['bucketStart', 'incomeMinor', 'expenseMinor'],
          properties: {
            bucketStart: { type: 'string' },
            incomeMinor: { type: 'string' },
            expenseMinor: { type: 'string' },
          },
        },
      },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          required: ['category', 'amountMinor', 'share'],
          properties: {
            category: { type: 'string' },
            amountMinor: { type: 'string' },
            share: { type: 'number' },
          },
        },
      },
    },
  },
  LedgerEvidence: {
    type: 'object',
    required: ['documentId', 'documentName', 'score', 'rule'],
    properties: {
      documentId: { type: 'string' },
      documentName: { type: 'string' },
      score: { type: 'number' },
      rule: { type: 'string' },
      matchedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  LedgerRowResponse: {
    type: 'object',
    required: ['id', 'date', 'name', 'amountMinor', 'isoCurrencyCode', 'accountId', 'accountName', 'reconciliationStatus', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      date: { type: 'string' },
      name: { type: 'string' },
      merchantName: { type: 'string', nullable: true },
      category: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      amountMinor: { type: 'string' },
      isoCurrencyCode: { type: 'string' },
      accountId: { type: 'string' },
      accountName: { type: 'string' },
      reconciliationStatus: {
        type: 'string',
        enum: ['UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'NEEDS_REVIEW', 'REJECTED'],
      },
      evidence: { $ref: '#/components/schemas/LedgerEvidence', nullable: true },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  LedgerPageResponse: {
    type: 'object',
    required: ['rows', 'total', 'page', 'pageSize', 'hasMore'],
    properties: {
      rows: {
        type: 'array',
        items: { $ref: '#/components/schemas/LedgerRowResponse' },
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      hasMore: { type: 'boolean' },
    },
  },
  ReconciliationSettingsDto: {
    type: 'object',
    required: ['dateWindowDays', 'autoMatchThresholdBps', 'timezone', 'lookbackDays', 'nightlyEnabled'],
    properties: {
      dateWindowDays: { type: 'integer' },
      autoMatchThresholdBps: { type: 'integer' },
      timezone: { type: 'string' },
      lookbackDays: { type: 'integer' },
      nightlyEnabled: { type: 'boolean' },
    },
  },
  ReconciliationReviewItemDto: {
    type: 'object',
    required: ['id', 'tenantId', 'bankTransactionId', 'documentId', 'confidenceScoreBps', 'status', 'suggestedRule', 'discrepancyReasons', 'createdAt'],
    properties: {
      id: { type: 'string' },
      tenantId: { type: 'string' },
      bankTransactionId: { type: 'string' },
      documentId: { type: 'string' },
      confidenceScoreBps: { type: 'integer' },
      status: {
        type: 'string',
        enum: ['AUTO_MATCHED', 'NEEDS_REVIEW', 'MANUAL_MATCHED', 'REJECTED'],
      },
      suggestedRule: { type: 'string' },
      discrepancyReasons: {
        type: 'array',
        items: { type: 'string' },
      },
      reviewedAt: { type: 'string', format: 'date-time', nullable: true },
      reviewedBy: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      bankTransaction: { type: 'object', nullable: true },
      document: { type: 'object', nullable: true },
    },
  },
  ReconciliationMetricsDto: {
    type: 'object',
    required: ['totalMatches', 'autoMatched', 'manualMatched', 'needsReview', 'rejected', 'autoMatchRate', 'reviewCount'],
    properties: {
      totalMatches: { type: 'integer' },
      autoMatched: { type: 'integer' },
      manualMatched: { type: 'integer' },
      needsReview: { type: 'integer' },
      rejected: { type: 'integer' },
      autoMatchRate: { type: 'number' },
      reviewCount: { type: 'integer' },
    },
  },
  ApiErrorResponse: {
    type: 'object',
    required: ['statusCode', 'message'],
    properties: {
      statusCode: { type: 'integer' },
      message: { type: 'string' },
      error: { type: 'string', nullable: true },
    },
  },
};

// 5. Ordenamiento recursivo determinista de claves
function sortObjectKeys(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortObjectKeys(value[key]);
  }
  return sorted;
}

// 6. Generador principal
export async function generateOpenApi(targetPath) {
  const outputPath = targetPath || resolve(rootDir, 'docs/openapi/api-gateway.json');

  enrichDtoMetadata();

  const { AppModule } = require(resolve(rootDir, 'apps/api-gateway/dist/app.module.js'));
  const { setupGatewayApp } = require(resolve(rootDir, 'apps/api-gateway/dist/setup.js'));

  // abortOnError: false → NestJS lanzará la excepción al llamador en lugar de hacer process.exit(1)
  // silencioso, lo que permite capturar y registrar correctamente el stack trace en CI.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  setupGatewayApp(app);

  const config = new DocumentBuilder()
    .setTitle('MyBusiness API Gateway')
    .setDescription('Documentación de endpoints públicos y proxy a microservicios de MyBusiness')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const extraModelsList = [
    contracts.RefreshTokenDto,
    contracts.CashflowSummaryQueryDto,
    contracts.SearchDocumentsQuery,
    contracts.ListReconciliationReviewQuery,
    contracts.ReconciliationMetricsQuery,
  ].filter(Boolean);

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: extraModelsList,
  });

  await app.close();

  // Filtrar endpoints de salud internos y /docs
  const cleanedPaths = {};
  for (const [pathKey, pathItem] of Object.entries(document.paths || {})) {
    if (pathKey.startsWith('/api/v1/health') || pathKey === '/docs' || pathKey === '/docs/') {
      continue;
    }
    cleanedPaths[pathKey] = pathItem;
  }
  document.paths = cleanedPaths;

  // Filtrar tags de salud
  if (Array.isArray(document.tags)) {
    document.tags = document.tags.filter((tag) => tag.name !== 'Health');
  }

  // Integrar esquemas canónicos
  if (!document.components) {
    document.components = {};
  }
  if (!document.components.schemas) {
    document.components.schemas = {};
  }
  for (const [name, schema] of Object.entries(CANONICAL_SCHEMAS)) {
    document.components.schemas[name] = schema;
  }

  // Ordenamiento determinista
  const deterministicDoc = sortObjectKeys(document);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(deterministicDoc, null, 2) + '\n', 'utf8');

  return outputPath;
}

// Ejecución directa si se invoca como script CLI
const isDirectRun = process.argv[1] && (
  resolve(process.argv[1]) === resolve(__filename) ||
  process.argv[1].endsWith('generate-openapi.mjs')
);

if (isDirectRun) {
  const customOut = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1];
  generateOpenApi(customOut)
    .then((path) => {
      console.log(`✓ OpenAPI generado exitosamente en: ${path}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error generando OpenAPI:', err);
      process.exit(1);
    });
}

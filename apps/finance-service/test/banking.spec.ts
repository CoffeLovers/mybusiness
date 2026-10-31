import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { BankProvider, TransactionType } from '@mybusiness/contracts';
import type { RequestContext } from '@mybusiness/contracts';
import { BankingEncryptionService } from '../src/banking/banking-encryption.service';
import type { FinanceDatabaseService } from '../src/database/database.service';
import { BankingAggregatorService } from '../src/banking/banking-aggregator.service';
import { BelvoAdapter } from '../src/banking/adapters/belvo.adapter';
import { PlaidAdapter } from '../src/banking/adapters/plaid.adapter';
import { BankingService } from '../src/banking/banking.service';
import { BankingWebhookService } from '../src/banking/banking-webhook.service';
import { BankingSyncService } from '../src/banking/banking-sync.service';

describe('Banking Module Unit Tests', () => {
  describe('BankingEncryptionService', () => {
    it('debe fallar en el constructor si falta BANK_ENCRYPTION_KEY y no hay flag de desarrollo', () => {
      const config = new ConfigService({});
      expect(() => new BankingEncryptionService(config)).toThrow(
        /BANK_ENCRYPTION_KEY es obligatoria al arrancar/,
      );
    });

    it('debe fallar si falta BANK_ENCRYPTION_KEY en entornos restringidos aunque el flag sea true', () => {
      for (const env of ['production', 'staging', 'prod', 'preprod']) {
        const config = new ConfigService({
          NODE_ENV: env,
          BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
        });
        expect(() => new BankingEncryptionService(config)).toThrow(
          /BANK_ENCRYPTION_KEY es obligatoria al arrancar/,
        );
      }
    });

    it('debe permitir clave insegura de fallback en NODE_ENV=test con BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY=true', async () => {
      const config = new ConfigService({
        NODE_ENV: 'test',
        BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
      });
      const service = new BankingEncryptionService(config);

      const secret = 'test-secret-dev-flag';
      const enc = await service.encrypt(secret);
      const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
      expect(dec).toBe(secret);
    });

    it('debe fallar si la clave tiene formato o longitud inválida', () => {
      const invalidKeys = [
        'short',
        '0123456789abcdef', // 16 chars
        'g'.repeat(64), // 64 chars pero no hex
        '0'.repeat(63), // 63 chars
        'passphrase_demasiado_larga_pero_no_hex_ni_base64_valido_para_32_bytes',
      ];

      for (const k of invalidKeys) {
        const config = new ConfigService({
          BANK_ENCRYPTION_KEY: k,
        });
        expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY inválida/);
      }
    });

    it('debe cifrar y descifrar correctamente con una clave de 32 bytes en base64', async () => {
      // 32 bytes en base64 (44 chars)
      const b64Key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: b64Key,
        BANK_ENCRYPTION_KEY_VERSION: 'v2',
      });
      const service = new BankingEncryptionService(config);

      const secret = 'access-sandbox-belvo-or-plaid';
      const enc = await service.encrypt(secret);
      expect(enc.keyVersion).toBe('v2');
      const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
      expect(dec).toBe(secret);
    });

    it('debe cifrar y descifrar un access_token correctamente usando AES-256-GCM con clave hex', async () => {
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        BANK_ENCRYPTION_KEY_VERSION: 'v1',
      });
      const service = new BankingEncryptionService(config);

      const secret = 'access-sandbox-12345-67890-test-token';
      const encrypted = await service.encrypt(secret);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext).not.toContain(secret);
      expect(encrypted.keyVersion).toBe('v1');

      const decrypted = await service.decrypt(encrypted.ciphertext, encrypted.keyVersion);
      expect(decrypted).toBe(secret);
    });

    it('debe permitir rotación de claves seleccionando la versión adecuada desde el keyring', async () => {
      const keyV1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const keyV2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

      // Servicio inicial con v1
      const configV1 = new ConfigService({
        BANK_ENCRYPTION_KEY: keyV1,
        BANK_ENCRYPTION_KEY_VERSION: 'v1',
      });
      const serviceV1 = new BankingEncryptionService(configV1);
      const secret = 'token-cifrado-con-v1';
      const encryptedV1 = await serviceV1.encrypt(secret);
      expect(encryptedV1.keyVersion).toBe('v1');

      // Servicio rotado a v2 pero con v1 en el keyring
      const configV2 = new ConfigService({
        BANK_ENCRYPTION_KEY: keyV2,
        BANK_ENCRYPTION_KEY_VERSION: 'v2',
        BANK_ENCRYPTION_KEY_RING: JSON.stringify({ v1: keyV1, v2: keyV2 }),
      });
      const serviceV2 = new BankingEncryptionService(configV2);

      // Puede descifrar el token generado con v1 usando la versión v1
      const decryptedOld = await serviceV2.decrypt(encryptedV1.ciphertext, 'v1');
      expect(decryptedOld).toBe(secret);

      // Token nuevo usa v2
      const encryptedV2 = await serviceV2.encrypt('token-nuevo-v2');
      expect(encryptedV2.keyVersion).toBe('v2');
      const decryptedNew = await serviceV2.decrypt(encryptedV2.ciphertext, 'v2');
      expect(decryptedNew).toBe('token-nuevo-v2');

      // Falla si la versión solicitada no existe en el keyring
      await expect(serviceV2.decrypt(encryptedV1.ciphertext, 'v999')).rejects.toThrow();
    });

    it('debe fallar al descifrar si el ciphertext es manipulado', async () => {
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const service = new BankingEncryptionService(config);

      const secret = 'access-sandbox-abcde';
      const encrypted = await service.encrypt(secret);

      const parts = encrypted.ciphertext.split(':');
      parts[2] = '00' + parts[2].slice(2);
      const tampered = parts.join(':');

      await expect(service.decrypt(tampered, encrypted.keyVersion)).rejects.toThrow();
    });
  });

  describe('BelvoAdapter (Deshabilitado)', () => {
    it('handleWebhook debe lanzar NotImplementedException con el mensaje de versión', async () => {
      const adapter = new BelvoAdapter();
      expect(adapter.provider).toBe(BankProvider.BELVO);

      await expect(adapter.handleWebhook({}, {}, '{}')).rejects.toThrow(NotImplementedException);
      await expect(adapter.handleWebhook({}, {}, '{}')).rejects.toThrow(
        /La integración con Belvo no está habilitada en esta versión \(solo Plaid\)\./,
      );
    });

    it('métodos de sincronización y conexión deben lanzar NotImplementedException', async () => {
      const adapter = new BelvoAdapter();

      await expect(adapter.createLinkOrConnect({ userId: 'u1', tenantId: 't1' })).rejects.toThrow(
        NotImplementedException,
      );
      await expect(adapter.exchange({ userId: 'u1', tenantId: 't1' })).rejects.toThrow(
        NotImplementedException,
      );
      await expect(adapter.getAccounts({ accessToken: 'tok' })).rejects.toThrow(
        NotImplementedException,
      );
      await expect(adapter.syncTransactions({ accessToken: 'tok' })).rejects.toThrow(
        NotImplementedException,
      );
      await expect(
        adapter.disconnect({ accessToken: 'tok', providerItemId: 'p1' }),
      ).rejects.toThrow(NotImplementedException);
    });
  });

  describe('BankingAggregatorService', () => {
    it('debe registrar y retornar los adaptadores correctos', () => {
      const plaid = new PlaidAdapter(new ConfigService());
      const belvo = new BelvoAdapter();
      const aggregator = new BankingAggregatorService(plaid, belvo);

      expect(aggregator.getAdapter(BankProvider.PLAID)).toBe(plaid);
      expect(aggregator.getAdapter(BankProvider.BELVO)).toBe(belvo);
    });

    it('debe lanzar BadRequestException si el provider no está soportado', () => {
      const plaid = new PlaidAdapter(new ConfigService());
      const belvo = new BelvoAdapter();
      const aggregator = new BankingAggregatorService(plaid, belvo);

      expect(() => aggregator.getAdapter('unknown' as BankProvider)).toThrow(BadRequestException);
    });
  });

  describe('PlaidAdapter Transaction Mapping', () => {
    it('debe normalizar el signo de Plaid a amountMinor y transactionType (ADR-003)', async () => {
      const baseTransaction = {
        account_id: 'acc_1',
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
        date: '2026-01-15',
        authorized_date: null,
        name: 'Movimiento',
        merchant_name: null,
        category: null,
        pending: false,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          added: [
            { ...baseTransaction, transaction_id: 'tx_expense', amount: 25.5 },
            { ...baseTransaction, transaction_id: 'tx_income', amount: -10 },
            { ...baseTransaction, transaction_id: 'tx_transfer', amount: 0 },
          ],
          modified: [],
          removed: [],
          next_cursor: 'cursor-1',
          has_more: false,
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const plaid = new PlaidAdapter(
          new ConfigService({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }),
        );

        const result = await plaid.syncTransactions({ accessToken: 'tok' });

        expect(
          result.added.map((t) => ({
            id: t.providerTransactionId,
            amountMinor: t.amountMinor,
            transactionType: t.transactionType,
          })),
        ).toEqual([
          {
            id: 'tx_expense',
            amountMinor: 2550n,
            transactionType: TransactionType.EXPENSE,
          },
          {
            id: 'tx_income',
            amountMinor: 1000n,
            transactionType: TransactionType.INCOME,
          },
          {
            id: 'tx_transfer',
            amountMinor: 0n,
            transactionType: TransactionType.TRANSFER,
          },
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('PlaidAdapter Exchange Institution Resolution', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function jsonResponse(body: unknown, status = 200) {
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      };
    }

    function plaidAdapter(): PlaidAdapter {
      return new PlaidAdapter(
        new ConfigService({
          PLAID_CLIENT_ID: 'id',
          PLAID_SECRET: 'secret',
          PLAID_COUNTRY_CODES: 'US,MX',
        }),
      );
    }

    it('debe resolver institutionId e institutionName consultando a Plaid', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/item/public_token/exchange')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'access-1', item_id: 'item-1', request_id: 'req-1' }),
          );
        }
        if (url.endsWith('/item/get')) {
          return Promise.resolve(jsonResponse({ item: { institution_id: 'ins_1' } }));
        }
        if (url.endsWith('/institutions/get_by_id')) {
          return Promise.resolve(jsonResponse({ institution: { name: 'Banco Uno' } }));
        }
        return Promise.reject(new Error(`URL no esperada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await plaidAdapter().exchange({
        userId: 'u1',
        tenantId: 't1',
        publicToken: 'public-1',
      });

      expect(result.accessToken).toBe('access-1');
      expect(result.providerItemId).toBe('item-1');
      expect(result.institutionId).toBe('ins_1');
      expect(result.institutionName).toBe('Banco Uno');

      const institutionCall = fetchMock.mock.calls.find(([url]: [string]) =>
        url.endsWith('/institutions/get_by_id'),
      );
      expect(institutionCall).toBeDefined();
      expect(JSON.parse(institutionCall[1].body)).toEqual({
        institution_id: 'ins_1',
        country_codes: ['US', 'MX'],
      });
    });

    it('si /item/get falla, el exchange sigue OK y no usa metadatos del cliente', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/item/public_token/exchange')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'access-2', item_id: 'item-2', request_id: 'req-2' }),
          );
        }
        if (url.endsWith('/item/get')) {
          return Promise.resolve(jsonResponse({ error_message: 'boom' }, 500));
        }
        return Promise.reject(new Error(`URL no esperada: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await plaidAdapter().exchange({
        userId: 'u1',
        tenantId: 't1',
        publicToken: 'public-2',
        metadata: { institution_name: 'Falso' },
      });

      expect(result.accessToken).toBe('access-2');
      expect(result.providerItemId).toBe('item-2');
      expect(result.institutionId).toBeUndefined();
      expect(result.institutionName).toBeUndefined();

      const requestedUrls = fetchMock.mock.calls.map(([url]: [string]) => url);
      expect(requestedUrls.some((url: string) => url.endsWith('/institutions/get_by_id'))).toBe(
        false,
      );
    });
  });

  describe('PlaidAdapter Webhook Verification', () => {
    let adapter: PlaidAdapter;
    let ecPrivateKey: any;
    let ecPublicKey: any;
    let ecJwk: any;

    beforeEach(() => {
      const keypair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      ecPrivateKey = keypair.privateKey;
      ecPublicKey = keypair.publicKey;
      ecJwk = ecPublicKey.export({ format: 'jwk' });

      const config = new ConfigService({
        PLAID_CLIENT_ID: 'test_client_id',
        PLAID_SECRET: 'test_secret',
        PLAID_ENV: 'sandbox',
      });
      adapter = new PlaidAdapter(config);
    });

    function createJwt(options: {
      kid?: string;
      alg?: string;
      iat?: number;
      rawBody: string;
      tamperSignature?: boolean;
      tamperHash?: boolean;
    }): string {
      const header = {
        alg: options.alg ?? 'ES256',
        kid: options.kid ?? 'plaid-kid-1',
      };
      const bodyHash = createHash('sha256').update(options.rawBody, 'utf8').digest('hex');
      const claims = {
        iat: options.iat ?? Math.floor(Date.now() / 1000),
        request_body_sha256: options.tamperHash ? '00'.repeat(32) : bodyHash,
      };

      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');

      const signer = createSign('sha256');
      signer.update(`${encodedHeader}.${encodedClaims}`);
      signer.end();
      const sig = signer.sign({ key: ecPrivateKey, dsaEncoding: 'ieee-p1363' });

      let sigBuf = Buffer.from(sig);
      if (options.tamperSignature) {
        sigBuf[0] ^= 0xff;
      }
      const encodedSig = sigBuf.toString('base64url');

      return `${encodedHeader}.${encodedClaims}.${encodedSig}`;
    }

    it('debe fallar si falta el cuerpo crudo (rawBody)', async () => {
      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, {}, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si falta la cabecera Plaid-Verification', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, {}, raw),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si el JWT está malformado', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      await expect(
        adapter.handleWebhook(
          { webhook_type: 'TRANSACTIONS' },
          { 'plaid-verification': 'malformed.jwt' },
          raw,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si alg no es ES256 o falta kid', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      const jwt = createJwt({ alg: 'HS256', rawBody: raw });
      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si el timestamp iat tiene más de 5 minutos de desfase', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      const oldIat = Math.floor(Date.now() / 1000) - 305;
      const jwt = createJwt({ iat: oldIat, rawBody: raw });

      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si la clave de verificación está expirada', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      const jwt = createJwt({ kid: 'expired-kid', rawBody: raw });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          key: {
            ...ecJwk,
            expired_at: Math.floor(Date.now() / 1000) - 10,
          },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(UnauthorizedException);

      vi.unstubAllGlobals();
    });

    it('debe fallar si la firma criptográfica es inválida', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      const jwt = createJwt({ kid: 'kid-1', rawBody: raw, tamperSignature: true });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          key: ecJwk,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(UnauthorizedException);

      vi.unstubAllGlobals();
    });

    it('debe fallar si el cuerpo fue alterado respecto al hash del claim', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
      const jwt = createJwt({ kid: 'kid-1', rawBody: raw, tamperHash: true });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          key: ecJwk,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        adapter.handleWebhook({ webhook_type: 'TRANSACTIONS' }, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(UnauthorizedException);

      vi.unstubAllGlobals();
    });

    it('debe verificar exitosamente y generar providerEventKey determinista con SHA-256', async () => {
      const payload = {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-sandbox-123',
      };
      const raw = JSON.stringify(payload);
      const jwt = createJwt({ kid: 'valid-kid-1', rawBody: raw });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          key: ecJwk,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result1 = await adapter.handleWebhook(payload, { 'plaid-verification': jwt }, raw);
      const result2 = await adapter.handleWebhook(payload, { 'plaid-verification': jwt }, raw);

      expect(result1.webhookType).toBe('TRANSACTIONS');
      expect(result1.webhookCode).toBe('SYNC_UPDATES_AVAILABLE');
      expect(result1.providerItemId).toBe('item-sandbox-123');
      expect(result1.providerEventKey).toBe(result2.providerEventKey);
      expect(result1.providerEventKey).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(result1.providerEventKey.length).toBe(64);

      vi.unstubAllGlobals();
    });

    it('debe fallar con BadRequestException si el payload carece de webhook_type', async () => {
      const payload = { item_id: 'item-123' };
      const raw = JSON.stringify(payload);
      const jwt = createJwt({ kid: 'valid-kid-2', rawBody: raw });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          key: ecJwk,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        adapter.handleWebhook(payload, { 'plaid-verification': jwt }, raw),
      ).rejects.toThrow(BadRequestException);

      vi.unstubAllGlobals();
    });
  });

  describe('BankingWebhookService Fail-Closed & Idempotency', () => {
    it('si el adapter lanza excepción de verificación, se propaga y db.insert nunca se llama', async () => {
      const mockDb = {
        select: vi.fn(),
        insert: vi.fn(),
      };
      const mockDbService = { db: mockDb } as any;

      const failingAdapter = {
        provider: BankProvider.PLAID,
        handleWebhook: vi.fn().mockRejectedValue(new UnauthorizedException('Firma inválida')),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(failingAdapter),
      } as any;

      const service = new BankingWebhookService(mockDbService, mockAggregator, {} as any);

      await expect(
        service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'bad-body'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('si el adapter no soporta handleWebhook, lanza BadRequestException y db.insert nunca se llama', async () => {
      const mockDb = {
        select: vi.fn(),
        insert: vi.fn(),
      };
      const mockDbService = { db: mockDb } as any;

      const adapterWithoutWebhook = {
        provider: BankProvider.PLAID,
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(adapterWithoutWebhook),
      } as any;

      const service = new BankingWebhookService(mockDbService, mockAggregator, {} as any);

      await expect(
        service.handleIncomingWebhook(BankProvider.PLAID, {}, {}, 'body'),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('si el evento ya fue registrado en el select inicial, devuelve already_processed sin insertar', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'existing-event-1' }]),
            }),
          }),
        }),
        insert: vi.fn(),
      };
      const mockDbService = { db: mockDb } as any;

      const adapter = {
        provider: BankProvider.PLAID,
        handleWebhook: vi.fn().mockResolvedValue({
          providerEventKey: 'deterministic-event-key-1',
          webhookType: 'TRANSACTIONS',
        }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(adapter),
      } as any;

      const service = new BankingWebhookService(mockDbService, mockAggregator, {} as any);

      const res = await service.handleIncomingWebhook(
        BankProvider.PLAID,
        { webhook_type: 'TRANSACTIONS' },
        {},
        'raw',
      );

      expect(res.status).toBe('already_processed');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('si ocurre condición de carrera en el insert (onConflictDoNothing devuelve vacío), retorna already_processed', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // No existía en el select
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]), // Carrera detectada por la restricción UNIQUE
            }),
          }),
        }),
      };
      const mockDbService = { db: mockDb } as any;

      const adapter = {
        provider: BankProvider.PLAID,
        handleWebhook: vi.fn().mockResolvedValue({
          providerEventKey: 'race-condition-key',
          webhookType: 'TRANSACTIONS',
        }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(adapter),
      } as any;

      const service = new BankingWebhookService(mockDbService, mockAggregator, {} as any);

      const res = await service.handleIncomingWebhook(
        BankProvider.PLAID,
        { webhook_type: 'TRANSACTIONS' },
        {},
        'raw',
      );

      expect(res.status).toBe('already_processed');
    });

    it('si el enrutamiento o procesamiento falla, actualiza a status=failed y relanza InternalServerErrorException (5xx)', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'event-uuid-1' }]),
            }),
          }),
        }),
        update: mockUpdate,
      };
      const mockDbService = { db: mockDb } as any;

      const adapter = {
        provider: BankProvider.PLAID,
        handleWebhook: vi.fn().mockResolvedValue({
          providerEventKey: 'key-fail-test',
          webhookType: 'TRANSACTIONS',
        }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(adapter),
      } as any;

      // Simulamos que al actualizar a processed falla la base de datos
      mockUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockRejectedValueOnce(new Error('DB connection drop')),
        }),
      });

      const service = new BankingWebhookService(mockDbService, mockAggregator, {} as any);

      await expect(
        service.handleIncomingWebhook(
          BankProvider.PLAID,
          { webhook_type: 'TRANSACTIONS' },
          {},
          'raw',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('BankingService Multi-tenant Isolation', () => {
    it('getConnections debe filtrar estrictamente por userId y tenantId', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const bankingService = new BankingService(
        mockDbService,
        {} as any,
        encryption,
        {} as any,
        config,
      );

      const ctx = {
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'TENANT_ADMIN' as any,
      };

      await bankingService.getConnections(ctx);
      expect(mockDb.where).toHaveBeenCalledTimes(1);
    });

    it('getConnectionAccounts debe lanzar NotFoundException si pertenece a otro tenant', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // No coincide tenantId + userId
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const bankingService = new BankingService(
        mockDbService,
        {} as any,
        encryption,
        {} as any,
        config,
      );

      const ctx = {
        userId: 'attacker-user',
        tenantId: 'tenant-B',
        role: 'VIEWER' as any,
      };

      await expect(
        bankingService.getConnectionAccounts(ctx, 'foreign-tenant-connection-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('syncConnection debe lanzar NotFoundException si la conexión es de otro tenant', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const bankingService = new BankingService(
        mockDbService,
        {} as any,
        encryption,
        {} as any,
        config,
      );

      const ctx = {
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'TENANT_ADMIN' as any,
      };

      await expect(bankingService.syncConnection(ctx, 'tenant-B-conn-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('disconnectConnection debe lanzar NotFoundException si pertenece a otro tenant', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const bankingService = new BankingService(
        mockDbService,
        {} as any,
        encryption,
        {} as any,
        config,
      );

      const ctx = {
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'TENANT_ADMIN' as any,
      };

      await expect(bankingService.disconnectConnection(ctx, 'tenant-B-conn-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('exchange debe lanzar ConflictException (409) si el ítem ya existe en la base de datos', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue({
              code: '23505',
              message:
                'duplicate key value violates unique constraint bank_connections_provider_env_item_uq',
            }),
          }),
        }),
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const mockAdapter = {
        provider: BankProvider.PLAID,
        exchange: vi.fn().mockResolvedValue({
          accessToken: 'access-123',
          providerItemId: 'item-dup-1',
        }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(mockAdapter),
      };

      const bankingService = new BankingService(
        mockDbService,
        mockAggregator as any,
        encryption,
        {} as any,
        config,
      );

      const ctx = {
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'TENANT_ADMIN' as any,
      };

      await expect(
        bankingService.exchange(ctx, {
          provider: BankProvider.PLAID,
          publicToken: 'public-tok',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('exchange debe marcar la conexión con status ERROR si getAccounts falla', async () => {
      let updatedStatus = '';

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 'conn-new-1',
                userId: 'user-1',
                tenantId: 'tenant-A',
                provider: 'plaid',
                status: 'pending',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
            onConflictDoNothing: vi.fn().mockResolvedValue([]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((val) => {
            updatedStatus = val.status;
            return {
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([
                  {
                    id: 'conn-new-1',
                    userId: 'user-1',
                    tenantId: 'tenant-A',
                    provider: 'plaid',
                    status: updatedStatus,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  },
                ]),
              }),
            };
          }),
        }),
      };
      const mockDbService = { db: mockDb } as any;
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);

      const mockAdapter = {
        provider: BankProvider.PLAID,
        exchange: vi.fn().mockResolvedValue({
          accessToken: 'access-123',
          providerItemId: 'item-new-1',
          accounts: [],
        }),
        getAccounts: vi.fn().mockRejectedValue(new Error('Plaid API Error')),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(mockAdapter),
      };

      const mockSync = {
        syncAccounts: vi.fn(),
      };

      const bankingService = new BankingService(
        mockDbService,
        mockAggregator as any,
        encryption,
        mockSync as any,
        config,
      );

      const ctx = {
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'TENANT_ADMIN' as any,
      };

      const res = await bankingService.exchange(ctx, {
        provider: BankProvider.PLAID,
        publicToken: 'public-tok',
      });

      expect(res.status).toBe('error');
    });
  });

  describe('Sync Pagination & State', () => {
    it('debe iterar múltiples páginas hasta hasMore=false y acumular totales', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cursor: 'cur-init' }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      const mockDbService = { db: mockDb } as any;

      const mockAdapter = {
        provider: BankProvider.PLAID,
        syncTransactions: vi
          .fn()
          .mockResolvedValueOnce({
            added: [{}],
            modified: [],
            removed: [],
            nextCursor: 'cur-page-2',
            hasMore: true,
          })
          .mockResolvedValueOnce({
            added: [{}],
            modified: [{}],
            removed: [],
            nextCursor: 'cur-final',
            hasMore: false,
          }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(mockAdapter),
      } as any;

      const mockEncryption = {
        decrypt: vi.fn().mockResolvedValue('access-token-decrypted'),
      } as any;

      const mockSync = {
        applyTransactionsSync: vi
          .fn()
          .mockResolvedValueOnce({ added: 1, modified: 0, removed: 0 })
          .mockResolvedValueOnce({ added: 1, modified: 1, removed: 0 }),
      } as any;

      const config = new ConfigService({
        BANKING_SYNC_MAX_PAGES: '10',
        BANKING_SYNC_MAX_DURATION_MS: '5000',
      });

      const bankingService = new BankingService(
        mockDbService,
        mockAggregator,
        mockEncryption,
        mockSync,
        config,
      );

      const fakeConnection = {
        id: 'conn-1',
        provider: BankProvider.PLAID,
        accessTokenCiphertext: 'cipher',
        tokenKeyVersion: 'v1',
      } as any;

      // Accedemos al método executeConnectionSync mediante cast
      const result = await (bankingService as any).executeConnectionSync(fakeConnection);

      expect(result.added).toBe(2);
      expect(result.modified).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBe('cur-final');
      expect(mockAdapter.syncTransactions).toHaveBeenCalledTimes(2);
    });

    it('debe detenerse ante cursor repetido para prevenir bucle infinito', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cursor: 'cur-repeat' }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      const mockDbService = { db: mockDb } as any;

      const mockAdapter = {
        provider: BankProvider.PLAID,
        syncTransactions: vi.fn().mockResolvedValue({
          added: [],
          modified: [],
          removed: [],
          nextCursor: 'cur-repeat', // Mismo cursor recibido
          hasMore: true,
        }),
      };
      const mockAggregator = {
        getAdapter: vi.fn().mockReturnValue(mockAdapter),
      } as any;

      const mockEncryption = {
        decrypt: vi.fn().mockResolvedValue('token'),
      } as any;

      const mockSync = {
        applyTransactionsSync: vi.fn().mockResolvedValue({ added: 0, modified: 0, removed: 0 }),
      } as any;

      const bankingService = new BankingService(
        mockDbService,
        mockAggregator,
        mockEncryption,
        mockSync,
        new ConfigService(),
      );

      const fakeConnection = {
        id: 'conn-loop',
        provider: BankProvider.PLAID,
        accessTokenCiphertext: 'c',
        tokenKeyVersion: 'v1',
      } as any;

      const result = await (bankingService as any).executeConnectionSync(fakeConnection);

      expect(mockAdapter.syncTransactions).toHaveBeenCalledTimes(1);
      expect(result.hasMore).toBe(true);
    });

    it('applyTransactionsSync debe marcar initialSyncComplete=true y lastSuccessfulSyncAt sólo cuando !hasMore', async () => {
      let insertedSyncState: any = null;
      let updatedConnection: any = null;

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'acc-uuid-1', providerAccountId: 'p_acc_1' }]),
          }),
        }),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            insertedSyncState = val;
            return {
              onConflictDoUpdate: vi.fn().mockResolvedValue([]),
            };
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((val) => {
            updatedConnection = val;
            return {
              where: vi.fn().mockResolvedValue([]),
            };
          }),
        })),
      };

      const mockDbService = {
        db: {
          transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
        },
      } as any;

      const syncService = new BankingSyncService(mockDbService);
      const conn = { id: 'conn-123' } as any;

      // 1. Página intermedia (hasMore: true)
      await syncService.applyTransactionsSync(conn, {
        added: [],
        modified: [],
        removed: [],
        nextCursor: 'cur-page-1',
        hasMore: true,
      });

      expect(insertedSyncState.initialSyncComplete).toBe(false);
      expect(updatedConnection).toBeNull(); // No actualiza lastSuccessfulSyncAt de bankConnections

      // 2. Última página (hasMore: false)
      await syncService.applyTransactionsSync(conn, {
        added: [],
        modified: [],
        removed: [],
        nextCursor: 'cur-page-final',
        hasMore: false,
      });

      expect(insertedSyncState.initialSyncComplete).toBe(true);
      expect(updatedConnection).toBeDefined();
      expect(updatedConnection.lastSuccessfulSyncAt).toBeDefined();
    });
  });

  describe('PlaidAdapter getAccounts', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubFetch(body: unknown, status = 200) {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('mapea saldos a centavos en BigInt e incluye rawMetadata', async () => {
      stubFetch({
        accounts: [
          {
            account_id: 'acc_plaid_1',
            name: 'Plaid Checking',
            official_name: 'Plaid Gold Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '0000',
            balances: {
              available: 110.5,
              current: 120.25,
              iso_currency_code: 'USD',
              unofficial_currency_code: null,
            },
          },
          {
            account_id: 'acc_plaid_2',
            name: 'Sin saldos',
            official_name: null,
            type: 'credit',
            subtype: null,
            mask: null,
            balances: {
              available: null,
              current: null,
              iso_currency_code: null,
              unofficial_currency_code: 'COP',
            },
          },
        ],
        item: { item_id: 'item_1' },
      });

      const adapter = new PlaidAdapter(
        new ConfigService({
          PLAID_CLIENT_ID: 'client',
          PLAID_SECRET: 'secret',
          PLAID_ENV: 'development',
        }),
      );

      const accounts = await adapter.getAccounts({ accessToken: 'access-tok' });

      expect(accounts).toHaveLength(2);
      expect(accounts[0]).toMatchObject({
        providerAccountId: 'acc_plaid_1',
        isoCurrencyCode: 'USD',
        balanceCurrentMinor: 12025n,
        balanceAvailableMinor: 11050n,
        rawMetadata: {
          type: 'depository',
          subtype: 'checking',
        },
      });
      expect(accounts[1].balanceCurrentMinor).toBeNull();
      expect(accounts[1].balanceAvailableMinor).toBeNull();
      expect(accounts[1].isoCurrencyCode).toBe('USD');
    });
  });

  describe('PlaidAdapter syncTransactions contract', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const baseTx = {
      account_id: 'acc_1',
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      date: '2026-05-01',
      authorized_date: '2026-05-02',
      name: 'Compra',
      merchant_name: 'Tienda',
      category: ['GENERAL_MERCHANDISE'],
      pending: false,
    };

    it('mapea added/modified/removed, has_more y next_cursor enviando el cursor', async () => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({
          added: [{ ...baseTx, transaction_id: 'tx_added', amount: 15.75 }],
          modified: [{ ...baseTx, transaction_id: 'tx_modified', amount: -3.5 }],
          removed: [{ transaction_id: 'tx_removed' }],
          next_cursor: 'cursor-next',
          has_more: true,
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PlaidAdapter(
        new ConfigService({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }),
      );

      const page = await adapter.syncTransactions({
        accessToken: 'tok',
        cursor: 'cursor-prev',
        count: 50,
      });

      expect(page.added[0]).toMatchObject({
        providerTransactionId: 'tx_added',
        amountMinor: 1575n,
        transactionType: TransactionType.EXPENSE,
        authorizedDate: '2026-05-02',
        category: ['GENERAL_MERCHANDISE'],
        rawMetadata: { plaid_transaction_id: 'tx_added', original_amount: 15.75 },
      });
      expect(page.modified[0]).toMatchObject({
        providerTransactionId: 'tx_modified',
        transactionType: TransactionType.INCOME,
      });
      expect(page.removed).toEqual([{ providerTransactionId: 'tx_removed' }]);
      expect(page.nextCursor).toBe('cursor-next');
      expect(page.hasMore).toBe(true);

      const init = fetchMock.mock.calls[0][1];
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ access_token: 'tok', cursor: 'cursor-prev', count: 50 });
      expect(fetchMock.mock.calls[0][0]).toBe('https://sandbox.plaid.com/transactions/sync');
    });

    it('omite cursor del body cuando no existe cursor previo', async () => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({
          added: [],
          modified: [],
          removed: [],
          next_cursor: '',
          has_more: false,
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PlaidAdapter(
        new ConfigService({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }),
      );
      await adapter.syncTransactions({ accessToken: 'tok' });

      const init = fetchMock.mock.calls[0][1];
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('cursor');
      expect(body.count).toBe(100);
    });
  });

  describe('PlaidAdapter disconnect', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('llama a /item/remove con el access_token', async () => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ removed: true, request_id: 'req-1' }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PlaidAdapter(
        new ConfigService({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }),
      );
      await adapter.disconnect({ accessToken: 'tok-remove', providerItemId: 'item-1' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://sandbox.plaid.com/item/remove');
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
      expect(body).toEqual({ access_token: 'tok-remove' });
    });

    it('no lanza si /item/remove falla porque se revoca localmente igual', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error_type: 'INVALID_REQUEST',
          error_code: 'ITEM_NOT_FOUND',
          error_message: 'item not found',
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PlaidAdapter(
        new ConfigService({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }),
      );

      await expect(
        adapter.disconnect({ accessToken: 'tok', providerItemId: 'item-1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('PlaidAdapter createLinkOrConnect webhook URL', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubLinkToken() {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({
          link_token: 'link-sandbox-123',
          expiration: '2026-12-31T23:59:59Z',
          request_id: 'req-link',
        }),
      }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function bodyOf(fetchMock: ReturnType<typeof stubLinkToken>): Record<string, unknown> {
      const init = fetchMock.mock.calls[0][1];
      return JSON.parse(String(init?.body)) as Record<string, unknown>;
    }

    it('no incluye webhook en el body si PLAID_WEBHOOK_URL no está configurada', async () => {
      const fetchMock = stubLinkToken();
      const adapter = new PlaidAdapter(
        new ConfigService({
          PLAID_CLIENT_ID: 'id',
          PLAID_SECRET: 'secret',
          PLAID_PRODUCTS: 'transactions,auth',
          PLAID_COUNTRY_CODES: 'US,CO',
        }),
      );

      const result = await adapter.createLinkOrConnect({ userId: 'user-1', tenantId: 'tenant-1' });

      expect(result.linkToken).toBe('link-sandbox-123');
      expect(result.expiration).toBe('2026-12-31T23:59:59Z');
      const body = bodyOf(fetchMock);
      expect(body).not.toHaveProperty('webhook');
      expect(body.products).toEqual(['transactions', 'auth']);
      expect(body.country_codes).toEqual(['US', 'CO']);
      expect(body.user).toEqual({ client_user_id: 'user-1' });
    });

    it('incluye webhook en el body si PLAID_WEBHOOK_URL está configurada', async () => {
      const fetchMock = stubLinkToken();
      const adapter = new PlaidAdapter(
        new ConfigService({
          PLAID_CLIENT_ID: 'id',
          PLAID_SECRET: 'secret',
          PLAID_WEBHOOK_URL: 'https://api.mybusiness.test/webhooks/plaid',
        }),
      );

      await adapter.createLinkOrConnect({ userId: 'user-1', tenantId: 'tenant-1' });

      expect(bodyOf(fetchMock).webhook).toBe('https://api.mybusiness.test/webhooks/plaid');
    });
  });

  describe('BankingService connections & local revocation', () => {
    function buildService(db: object, aggregator: object) {
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const encryption = new BankingEncryptionService(config);
      return {
        encryption,
        service: new BankingService(
          { db } as unknown as FinanceDatabaseService,
          aggregator as unknown as BankingAggregatorService,
          encryption,
          {} as unknown as BankingSyncService,
          config,
        ),
      };
    }

    const ctx = {
      userId: 'user-1',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN',
    } as unknown as RequestContext;

    it('getConnections filtra por tenant+user y mapea sin exponer tokens', async () => {
      const now = new Date('2026-10-01T12:00:00.000Z');
      const rows = [
        {
          id: 'conn-map-1',
          userId: 'user-1',
          tenantId: 'tenant-A',
          provider: BankProvider.PLAID,
          providerItemId: 'item-secret',
          accessTokenCiphertext: 'super-secret-ciphertext',
          tokenKeyVersion: 'v1',
          institutionId: 'ins_1',
          institutionName: 'Banco Uno',
          environment: 'sandbox',
          status: 'active',
          consentedProducts: [],
          lastSuccessfulSyncAt: now,
          rawMetadata: {},
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(rows),
      };

      const { service } = buildService(mockDb, {});
      const result = await service.getConnections(ctx);

      expect(mockDb.where).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        {
          id: 'conn-map-1',
          provider: BankProvider.PLAID,
          institutionId: 'ins_1',
          institutionName: 'Banco Uno',
          status: 'active',
          lastSuccessfulSyncAt: '2026-10-01T12:00:00.000Z',
          createdAt: '2026-10-01T12:00:00.000Z',
          updatedAt: '2026-10-01T12:00:00.000Z',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('super-secret-ciphertext');
      expect(result[0]).not.toHaveProperty('accessTokenCiphertext');
    });

    it('disconnectConnection revoca localmente aunque el adapter falle', async () => {
      const encrypted = await new BankingEncryptionService(
        new ConfigService({
          BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
      ).encrypt('access-token-local');

      const revocationSets: Array<Record<string, unknown>> = [];
      const connection = {
        id: 'conn-revoke-1',
        userId: 'user-1',
        tenantId: 'tenant-A',
        provider: BankProvider.PLAID,
        providerItemId: 'item-1',
        accessTokenCiphertext: encrypted.ciphertext,
        tokenKeyVersion: encrypted.keyVersion,
        institutionId: null,
        institutionName: 'Banco',
        environment: 'sandbox',
        status: 'active',
        consentedProducts: [],
        lastSuccessfulSyncAt: null,
        rawMetadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([connection]),
        update: vi.fn().mockReturnValue({
          set: vi.fn((values: Record<string, unknown>) => {
            revocationSets.push(values);
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        }),
      };

      const { service: serviceWithDb } = buildService(mockDb, {
        getAdapter: vi.fn().mockReturnValue({
          provider: BankProvider.PLAID,
          disconnect: vi.fn().mockRejectedValue(new Error('Plaid no disponible')),
        }),
      });

      await expect(serviceWithDb.disconnectConnection(ctx, 'conn-revoke-1')).resolves.toEqual({
        success: true,
      });

      expect(revocationSets).toHaveLength(1);
      expect(revocationSets[0]).toMatchObject({ status: 'revoked' });
      expect(revocationSets[0].deletedAt).toBeInstanceOf(Date);
    });
  });
});

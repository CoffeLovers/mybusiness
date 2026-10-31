import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { BankProvider } from '@mybusiness/contracts';
import { BankingEncryptionService } from '../src/banking/banking-encryption.service';
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
        /BANK_ENCRYPTION_KEY es obligatoria al arrancar la aplicación/,
      );
    });

    it('debe fallar si falta BANK_ENCRYPTION_KEY en entornos restringidos aunque el flag sea true', () => {
      for (const env of ['production', 'staging', 'prod', 'preprod']) {
        const config = new ConfigService({
          NODE_ENV: env,
          BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
        });
        expect(() => new BankingEncryptionService(config)).toThrow(
          /BANK_ENCRYPTION_KEY es obligatoria al arrancar la aplicación/,
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

  describe('BelvoAdapter (Fail-Closed)', () => {
    it('handleWebhook debe lanzar UnauthorizedException (401) en fail-closed', async () => {
      const adapter = new BelvoAdapter();
      expect(adapter.provider).toBe(BankProvider.BELVO);

      await expect(adapter.handleWebhook({}, {}, '{}')).rejects.toThrow(UnauthorizedException);
      await expect(adapter.handleWebhook({}, {}, '{}')).rejects.toThrow(
        /Verificación de webhooks Belvo no implementada/,
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
});

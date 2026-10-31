import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { BankProvider } from '@mybusiness/contracts';
import { BankingEncryptionService } from '../src/banking/banking-encryption.service';
import { BankingAggregatorService } from '../src/banking/banking-aggregator.service';
import { BelvoAdapter } from '../src/banking/adapters/belvo.adapter';
import { PlaidAdapter } from '../src/banking/adapters/plaid.adapter';
import { BankingService } from '../src/banking/banking.service';

describe('Banking Module Unit Tests', () => {
  describe('BankingEncryptionService', () => {
    let service: BankingEncryptionService;
    let configService: ConfigService;

    beforeEach(() => {
      configService = new ConfigService({
        BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        BANK_ENCRYPTION_KEY_VERSION: 'v1',
      });
      service = new BankingEncryptionService(configService);
    });

    it('debe cifrar y descifrar un access_token correctamente usando AES-256-GCM', async () => {
      const secret = 'access-sandbox-12345-67890-test-token';
      const encrypted = await service.encrypt(secret);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext).not.toContain(secret);
      expect(encrypted.keyVersion).toBe('v1');

      const decrypted = await service.decrypt(encrypted.ciphertext, encrypted.keyVersion);
      expect(decrypted).toBe(secret);
    });

    it('debe fallar al descifrar si el ciphertext es manipulado', async () => {
      const secret = 'access-sandbox-abcde';
      const encrypted = await service.encrypt(secret);

      const parts = encrypted.ciphertext.split(':');
      // Manipular el texto cifrado
      parts[2] = '00' + parts[2].slice(2);
      const tampered = parts.join(':');

      await expect(service.decrypt(tampered, encrypted.keyVersion)).rejects.toThrow();
    });
  });

  describe('BelvoAdapter', () => {
    it('debe lanzar NotImplementedException en todos sus métodos', async () => {
      const adapter = new BelvoAdapter();
      expect(adapter.provider).toBe(BankProvider.BELVO);

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
      await expect(adapter.handleWebhook({})).rejects.toThrow(NotImplementedException);
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

  describe('PlaidAdapter', () => {
    let adapter: PlaidAdapter;

    beforeEach(() => {
      const config = new ConfigService({
        PLAID_CLIENT_ID: 'test_client_id',
        PLAID_SECRET: 'test_secret',
        PLAID_ENV: 'sandbox',
        PLAID_PRODUCTS: 'transactions',
        PLAID_COUNTRY_CODES: 'US',
        PLAID_WEBHOOK_URL: 'http://test.com/webhook',
      });
      adapter = new PlaidAdapter(config);
    });

    it('createLinkOrConnect debe llamar a /link/token/create con client_user_id', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          link_token: 'link-sandbox-12345',
          expiration: '2026-11-01T00:00:00Z',
          request_id: 'req_123',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.createLinkOrConnect({
        userId: 'user-uuid-1',
        tenantId: 'tenant-uuid-1',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://sandbox.plaid.com/link/token/create');
      const body = JSON.parse(call[1].body);
      expect(body.user.client_user_id).toBe('user-uuid-1');
      expect(body.products).toEqual(['transactions']);
      expect(result.linkToken).toBe('link-sandbox-12345');

      vi.unstubAllGlobals();
    });

    it('exchange debe llamar a /item/public_token/exchange y retornar item_id', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-sandbox-token-xyz',
          item_id: 'item-sandbox-123',
          request_id: 'req_456',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.exchange({
        userId: 'user-uuid-1',
        tenantId: 'tenant-uuid-1',
        publicToken: 'public-sandbox-abc',
        metadata: { institution_name: 'Chase' },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.public_token).toBe('public-sandbox-abc');
      expect(result.providerItemId).toBe('item-sandbox-123');
      expect(result.accessToken).toBe('access-sandbox-token-xyz');
      expect(result.institutionName).toBe('Chase');

      vi.unstubAllGlobals();
    });

    it('exchange debe fallar si no se proporciona publicToken', async () => {
      await expect(adapter.exchange({ userId: 'u1', tenantId: 't1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('BankingService Ownership & Security', () => {
    it('getConnectionAccounts debe lanzar NotFoundException si la conexión pertenece a otro usuario', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // No encuentra conexión que pertenezca a este userId
      };

      const mockDbService = { db: mockDb } as any;
      const mockAggregator = {} as any;
      const mockEncryption = {} as any;
      const mockSync = {} as any;
      const config = new ConfigService();

      const bankingService = new BankingService(
        mockDbService,
        mockAggregator,
        mockEncryption,
        mockSync,
        config,
      );

      const ctx = {
        userId: 'attacker-user-id',
        tenantId: 'attacker-tenant-id',
        role: 'VIEWER' as any,
      };

      await expect(
        bankingService.getConnectionAccounts(ctx, 'victim-connection-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('disconnectConnection debe validar ownership antes de revocar', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      const mockDbService = { db: mockDb } as any;
      const bankingService = new BankingService(
        mockDbService,
        {} as any,
        {} as any,
        {} as any,
        new ConfigService(),
      );

      const ctx = {
        userId: 'attacker-user-id',
        tenantId: 'tenant-id',
        role: 'VIEWER' as any,
      };

      await expect(
        bankingService.disconnectConnection(ctx, 'foreign-connection-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

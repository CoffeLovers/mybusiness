import { describe, expect, it, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  BankingPatterns,
  BankProvider,
  ExchangeBankConnectionDto,
  StartBankConnectionDto,
  UserRole,
} from '@mybusiness/contracts';
import { BankingService } from '../src/banking/banking.service';
import { BankingController, BankingWebhooksController } from '../src/banking/banking.controller';

describe('Banking Gateway Unit Tests', () => {
  let mockClientProxy: any;
  let service: BankingService;
  let controller: BankingController;
  let webhooksController: BankingWebhooksController;

  const mockUser = {
    userId: 'user-uuid-123',
    tenantId: 'tenant-uuid-456',
    email: 'user@test.com',
    role: UserRole.TENANT_ADMIN,
  };

  beforeEach(() => {
    mockClientProxy = {
      send: vi.fn().mockReturnValue(of({ success: true })),
    };
    service = new BankingService(mockClientProxy);
    controller = new BankingController(service);
    webhooksController = new BankingWebhooksController(service);
  });

  describe('BankingController', () => {
    it('connect / link-token debe propagar el contexto autenticado y no confiar en userId del body', async () => {
      const dto: StartBankConnectionDto = {
        provider: BankProvider.PLAID,
      };

      await controller.connect(mockUser, dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.CREATE_LINK_OR_CONNECT,
        expect.objectContaining({
          provider: BankProvider.PLAID,
          userId: 'user-uuid-123',
          tenantId: 'tenant-uuid-456',
          role: UserRole.TENANT_ADMIN,
        }),
      );
    });

    it('exchange debe enviar publicToken y contexto autenticado al finance-service', async () => {
      const dto: ExchangeBankConnectionDto = {
        provider: BankProvider.PLAID,
        publicToken: 'public-sandbox-token',
      };

      await controller.exchange(mockUser, dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.EXCHANGE_CONNECTION,
        expect.objectContaining({
          provider: BankProvider.PLAID,
          publicToken: 'public-sandbox-token',
          userId: 'user-uuid-123',
        }),
      );
    });

    it('getConnections debe enviar el userId del usuario autenticado', async () => {
      await controller.getConnections(mockUser);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.GET_CONNECTIONS,
        expect.objectContaining({
          userId: 'user-uuid-123',
        }),
      );
    });

    it('getConnectionAccounts debe incluir connectionId y userId', async () => {
      await controller.getConnectionAccounts(mockUser, 'conn-789');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.GET_CONNECTION_ACCOUNTS,
        expect.objectContaining({
          connectionId: 'conn-789',
          userId: 'user-uuid-123',
        }),
      );
    });

    it('syncConnection debe solicitar sync para connectionId', async () => {
      await controller.syncConnection(mockUser, 'conn-789');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.SYNC_CONNECTION,
        expect.objectContaining({
          connectionId: 'conn-789',
          userId: 'user-uuid-123',
        }),
      );
    });

    it('disconnectConnection debe enviar orden de desconexión', async () => {
      await controller.disconnectConnection(mockUser, 'conn-789');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.DISCONNECT_CONNECTION,
        expect.objectContaining({
          connectionId: 'conn-789',
          userId: 'user-uuid-123',
        }),
      );
    });
  });

  describe('BankingWebhooksController', () => {
    it('handlePlaidWebhook debe reenviar rawBody y headers al RPC de finance-service', async () => {
      const payload = { webhook_type: 'TRANSACTIONS', item_id: 'item-123' };
      const rawBodyStr = JSON.stringify(payload);
      const headers = { 'plaid-verification': 'jwt.signature.here' };
      const req = { rawBody: Buffer.from(rawBodyStr) } as any;

      await webhooksController.handlePlaidWebhook(payload, headers, req);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.HANDLE_WEBHOOK,
        expect.objectContaining({
          provider: BankProvider.PLAID,
          payload,
          headers,
          rawBody: rawBodyStr,
        }),
      );
    });

    it('handlePlaidWebhook debe propagar UnauthorizedException (HTTP 401) si la firma es inválida', async () => {
      const payload = { webhook_type: 'TRANSACTIONS' };
      const req = { rawBody: Buffer.from('{"tampered":true}') } as any;
      mockClientProxy.send = vi.fn().mockReturnValue(
        throwError(() => ({
          status: 401,
          message: 'Firma de webhook inválida.',
          name: 'UnauthorizedException',
        })),
      );

      await expect(
        firstValueFrom(
          webhooksController.handlePlaidWebhook(payload, { 'plaid-verification': 'bad' }, req),
        ),
      ).rejects.toMatchObject({
        status: 401,
      });
    });

    it('handleBelvoWebhook debe reenviar rawBody y headers al RPC de finance-service', async () => {
      const payload = { event: 'link_created', link_id: 'link-456' };
      const rawBodyStr = JSON.stringify(payload);
      const req = { rawBody: Buffer.from(rawBodyStr) } as any;

      await webhooksController.handleBelvoWebhook(payload, {}, req);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        BankingPatterns.HANDLE_WEBHOOK,
        expect.objectContaining({
          provider: BankProvider.BELVO,
          payload,
          rawBody: rawBodyStr,
        }),
      );
    });

    it('handleBelvoWebhook debe responder 401 Unauthorized al estar en modo fail-closed', async () => {
      mockClientProxy.send = vi.fn().mockReturnValue(
        throwError(() => ({
          status: 401,
          message: 'Verificación de webhooks Belvo no implementada.',
          name: 'UnauthorizedException',
        })),
      );

      await expect(
        firstValueFrom(
          webhooksController.handleBelvoWebhook({}, {}, { rawBody: Buffer.from('{}') } as any),
        ),
      ).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});

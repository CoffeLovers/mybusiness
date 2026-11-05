import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PayPalClient, PayPalClientError } from '../src/payments/paypal-client';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';

function configStub(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

const createOrderArgs = (idempotencyKey: string) => ({
  amountMinor: '1000',
  currency: 'USD',
  description: 'x',
  invoiceRef: INVOICE_ID,
  idempotencyKey,
});

describe('PayPalClient (transporte stubbeado sin credenciales reales)', () => {
  const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>();
  const okResponse = (status: number, body: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sin credenciales por entorno falla con código estable y sin llamadas de red', async () => {
    const client = new PayPalClient(configStub({}));

    await expect(client.createOrder(createOrderArgs('k1'))).rejects.toMatchObject({
      code: 'PAYPAL_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa sandbox por defecto, valida el enlace approve y cachéa el token', async () => {
    const client = new PayPalClient(
      configStub({ PAYPAL_CLIENT_ID: 'ci', PAYPAL_CLIENT_SECRET: 'cs' }),
    );
    expect(client.baseUrl).toBe(SANDBOX_BASE_URL);

    fetchMock.mockResolvedValueOnce(okResponse(200, { access_token: 'token-1', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(
      okResponse(201, {
        id: 'PAYPAL-123',
        status: 'CREATED',
        links: [
          { rel: 'self', href: `${SANDBOX_BASE_URL}/v2/checkout/orders/PAYPAL-123` },
          { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123' },
        ],
      }),
    );

    const order = await client.createOrder(createOrderArgs('idem-1'));

    expect(order.id).toBe('PAYPAL-123');
    expect(order.status).toBe('CREATED');
    expect(order.links.find((link) => link.rel === 'approve')?.href).toContain('checkoutnow');

    const [, tokenInit] = fetchMock.mock.calls[0];
    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(`${SANDBOX_BASE_URL}/v1/oauth2/token`);
    expect(tokenInit).toMatchObject({ method: 'POST', body: 'grant_type=client_credentials' });

    // Segunda creación: reutiliza el token cacheado (sólo se consume la orden).
    fetchMock.mockResolvedValueOnce(
      okResponse(201, {
        id: 'PAYPAL-456',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://x/y' }],
      }),
    );
    await client.createOrder(createOrderArgs('idem-2'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [secondOrderUrl] = fetchMock.mock.calls[2];
    expect(secondOrderUrl).toBe(`${SANDBOX_BASE_URL}/v2/checkout/orders`);
  });

  it('serializa el importe entero como decimal del proveedor vía contracts/money', async () => {
    const client = new PayPalClient(
      configStub({ PAYPAL_CLIENT_ID: 'ci', PAYPAL_CLIENT_SECRET: 'cs' }),
    );
    fetchMock.mockResolvedValueOnce(okResponse(200, { access_token: 't', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(
      okResponse(201, {
        id: 'P1',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://x/y' }],
      }),
    );

    await client.createOrder({ ...createOrderArgs('k'), amountMinor: '25000' });

    const [, orderInit] = fetchMock.mock.calls[1];
    const parsed = JSON.parse(orderInit.body as string) as Record<string, unknown>;
    expect(parsed.intent).toBe('CAPTURE');
    const unit = (parsed.purchase_units as Array<Record<string, unknown>>)[0];
    expect(unit.invoice_id).toBe(INVOICE_ID);
    expect(unit.custom_id).toBe('k');
    expect(unit.amount).toEqual({ currency_code: 'USD', value: '250.00' });
  });

  it('traduce el 401 del proveedor en PAYPAL_AUTH sin exponer el cuerpo', async () => {
    const client = new PayPalClient(
      configStub({ PAYPAL_CLIENT_ID: 'ci', PAYPAL_CLIENT_SECRET: 'cs' }),
    );
    fetchMock.mockResolvedValueOnce(
      okResponse(401, { error_description: 'invalid_client_credentials' }),
    );

    const error = await client.createOrder(createOrderArgs('k')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalClientError);
    expect((error as PayPalClientError).code).toBe('PAYPAL_AUTH');
    expect((error as PayPalClientError).message).not.toContain('invalid_client');
  });

  it('traduce el timeout del transporte en PAYPAL_TIMEOUT', async () => {
    const client = new PayPalClient(
      configStub({ PAYPAL_CLIENT_ID: 'ci', PAYPAL_CLIENT_SECRET: 'cs' }),
    );
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

    await expect(client.createOrder(createOrderArgs('k'))).rejects.toMatchObject({
      code: 'PAYPAL_TIMEOUT',
    });
  });

  it('traduce errores 4xx/5xx del proveedor en PAYPAL_PROVIDER con mensaje genérico', async () => {
    const client = new PayPalClient(
      configStub({ PAYPAL_CLIENT_ID: 'ci', PAYPAL_CLIENT_SECRET: 'cs' }),
    );
    fetchMock.mockResolvedValueOnce(okResponse(200, { access_token: 't', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(okResponse(400, { name: 'INTERNAL_SERVICE_ERROR' }));

    const error = await client.createOrder(createOrderArgs('k')).catch((e: unknown) => e);

    expect((error as PayPalClientError).code).toBe('PAYPAL_PROVIDER');
    expect((error as PayPalClientError).providerStatus).toBe(400);
    expect((error as PayPalClientError).message).not.toContain('INTERNAL_SERVICE_ERROR');
  });
});

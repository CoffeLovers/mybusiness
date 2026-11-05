import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { minorToPayPalDecimal, MoneyFormatError } from '@mybusiness/contracts';

/**
 * Modo de ejecución del proveedor. Resuelve la URL base del API de PayPal:
 * `sandbox` → api-m.sandbox.paypal.com, `live` → api-m.paypal.com. Se toma de
 * la variable `PAYPAL_MODE` (sandbox por defecto para no apuntar a producción).
 */
export type PayPalMode = 'sandbox' | 'live';

/** Códigos estables del cliente; nunca exponen detalles del proveedor. */
export type PayPalClientErrorCode =
  | 'PAYPAL_AUTH'
  | 'PAYPAL_TIMEOUT'
  | 'PAYPAL_NETWORK'
  | 'PAYPAL_RATE_LIMITED'
  | 'PAYPAL_PROVIDER'
  | 'PAYPAL_INVALID_RESPONSE'
  | 'PAYPAL_NOT_CONFIGURED';

interface PayPalLink {
  rel: string;
  href: string;
  method?: string;
}

/** Orden normalizada devuelta por el cliente. */
export interface PayPalCreatedOrder {
  id: string;
  status: string;
  links: PayPalLink[];
  /** Respuesta cruda del proveedor para persistir el replay idempotente. */
  raw: Record<string, unknown>;
}

export interface PayPalCreateOrderCommand {
  /** Entero en unidad mínima; el cliente convertiría el decimal. */
  amountMinor: string;
  currency: string;
  description: string;
  /** UUID de la factura que respalda el cobro (invoice_id del proveedor). */
  invoiceRef: string;
  /** Clave de idempotencia del cliente (custom_id y PayPal-Request-Id). */
  idempotencyKey: string;
  /** URLs opcionales de retorno configuradas por despliegue. */
  returnUrl?: string;
  cancelUrl?: string;
}

/** Error tipado con código estable; el mensaje no contiene credenciales ni stack del proveedor. */
export class PayPalClientError extends Error {
  constructor(
    readonly code: PayPalClientErrorCode,
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = PayPalClientError.name;
  }
}

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE_URL = 'https://api-m.paypal.com';
const DEFAULT_TIMEOUT_MS = 10_000;

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Cliente HTTP de PayPal (OAuth2 + Orders v2). Las credenciales se leen
 * exclusivamente de las variables de entorno `PAYPAL_CLIENT_ID` y
 * `PAYPAL_CLIENT_SECRET`; el token se cachea en memoria con margen de
 * expiración. Ningún log ni mensaje de error incluye el token, las
 * credenciales o el cuerpo bruto del proveedor.
 */
export class PayPalClient {
  private readonly logger = new Logger(PayPalClient.name);
  private readonly mode: PayPalMode;
  private readonly timeoutMs: number;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly returnUrl: string | undefined;
  private readonly cancelUrl: string | undefined;
  private tokenCache: TokenCache | null = null;

  constructor(config: ConfigService) {
    const mode = config.get<string>('PAYPAL_MODE', 'sandbox');
    this.mode = mode === 'live' ? 'live' : 'sandbox';
    const configuredTimeout = Number(config.get<string | number>('PAYPAL_TIMEOUT_MS'));
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_TIMEOUT_MS;
    this.clientId = config.get<string>('PAYPAL_CLIENT_ID');
    this.clientSecret = config.get<string>('PAYPAL_CLIENT_SECRET');
    this.returnUrl = config.get<string>('PAYPAL_RETURN_URL') || undefined;
    this.cancelUrl = config.get<string>('PAYPAL_CANCEL_URL') || undefined;
  }

  /** URL base según el modo configurado (sandbox | producción). */
  get baseUrl(): string {
    return this.mode === 'live' ? LIVE_BASE_URL : SANDBOX_BASE_URL;
  }

  private get isConfigured(): boolean {
    return (
      typeof this.clientId === 'string' &&
      this.clientId.length > 0 &&
      typeof this.clientSecret === 'string' &&
      this.clientSecret.length > 0
    );
  }

  /** Elimina el token cacheado; útil en tests para forzar una nueva emisión. */
  invalidateToken(): void {
    this.tokenCache = null;
  }

  async createOrder(command: PayPalCreateOrderCommand): Promise<PayPalCreatedOrder> {
    let decimalValue: string;
    try {
      decimalValue = minorToPayPalDecimal(command.amountMinor, command.currency);
    } catch {
      throw new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'El importe del cobro no es representable en la moneda indicada',
      );
    }

    const accessToken = await this.accessToken();

    const purchaseUnit: Record<string, unknown> = {
      invoice_id: command.invoiceRef,
      custom_id: command.idempotencyKey,
      description: command.description,
      amount: {
        currency_code: command.currency,
        value: decimalValue,
      },
    };

    const body: Record<string, unknown> = {
      intent: 'CAPTURE',
      purchase_units: [purchaseUnit],
    };

    if (this.returnUrl || this.cancelUrl) {
      body.application_context = {
        ...(this.returnUrl ? { return_url: this.returnUrl } : {}),
        ...(this.cancelUrl ? { cancel_url: this.cancelUrl } : {}),
      };
    }

    const response = await this.request(
      'POST',
      `${this.baseUrl}/v2/checkout/orders`,
      accessToken,
      JSON.stringify(body),
      { 'PayPal-Request-Id': command.idempotencyKey },
    );

    if (!response.ok) {
      throw this.toProviderError(response.status);
    }

    return this.parseCreatedOrder(await response.text(), 'createOrder');
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    if (!this.isConfigured) {
      throw new PayPalClientError(
        'PAYPAL_NOT_CONFIGURED',
        'Las credenciales de PayPal no están configuradas',
      );
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.toTransportError(error);
    }

    if (!response.ok) {
      throw new PayPalClientError(
        'PAYPAL_AUTH',
        'No se pudo autenticar contra el proveedor de pagos',
        response.status,
      );
    }

    const parsed = this.parseJson(await response.text());
    const token = typeof parsed?.access_token === 'string' ? parsed.access_token : undefined;
    const expiresIn = typeof parsed?.expires_in === 'number' ? parsed.expires_in : undefined;

    if (!token || expiresIn === undefined) {
      throw new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'La autenticación del proveedor devolvió una respuesta inesperada',
        response.status,
      );
    }

    // El token anterior a expiración tiene un margen de gracia de 60 s.
    this.tokenCache = { token, expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000 };
    return token;
  }

  private async request(
    method: string,
    url: string,
    accessToken: string,
    body: string,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.toTransportError(error);
    }
  }

  /** Traduce errores de transporte a códigos estables sin filtrar detalles. */
  private toTransportError(error: unknown): PayPalClientError {
    if (error instanceof PayPalClientError) {
      return error;
    }

    if (error instanceof MoneyFormatError) {
      return new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'El importe del cobro no es representable',
      );
    }

    const name = error instanceof Error ? error.name : 'UnknownError';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new PayPalClientError('PAYPAL_TIMEOUT', 'El proveedor de pagos no respondió a tiempo');
    }

    this.logger.warn(`Fallo de transporte contra el proveedor de pagos (${name})`);
    return new PayPalClientError('PAYPAL_NETWORK', 'No se pudo contactar al proveedor de pagos');
  }

  /** Mapea un estado HTTP del proveedor a un código estable; nunca incluye el cuerpo. */
  private toProviderError(status: number): PayPalClientError {
    if (status === 401 || status === 403) {
      return new PayPalClientError(
        'PAYPAL_AUTH',
        'El proveedor de pagos rechazó la autenticación',
        status,
      );
    }
    if (status === 429) {
      return new PayPalClientError(
        'PAYPAL_RATE_LIMITED',
        'El proveedor de pagos está limitando las solicitudes',
        status,
      );
    }
    return new PayPalClientError(
      'PAYPAL_PROVIDER',
      'El proveedor de pagos rechazó la creación de la orden',
      status,
    );
  }

  private parseCreatedOrder(text: string, context: string): PayPalCreatedOrder {
    const parsed = this.parseJson(text);
    const id = typeof parsed?.id === 'string' ? parsed.id : undefined;
    const status = typeof parsed?.status === 'string' ? parsed.status : undefined;
    const links = Array.isArray(parsed?.links)
      ? (parsed.links as unknown[]).filter(
          (link): link is PayPalLink =>
            !!link &&
            typeof link === 'object' &&
            typeof (link as PayPalLink).rel === 'string' &&
            typeof (link as PayPalLink).href === 'string',
        )
      : [];

    if (!id || !status) {
      this.logger.warn(`Respuesta inesperada del proveedor en ${context}`);
      throw new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'El proveedor de pagos devolvió una orden sin identificador',
      );
    }

    const raw = this.isPlainObject(parsed) ? parsed : ({} as Record<string, unknown>);
    return { id, status, links, raw };
  }

  private parseJson(text: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(text);
      return this.isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

import { Injectable, Logger } from '@nestjs/common';
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

/**
 * Resultado de la captura de una orden (SF3-09). La respuesta de
 * `capture` trae el id de la orden con las capturas anidadas en
 * `purchase_units[0].payments.captures[0]`; se identifican de forma
 * defensiva y el raw completo queda disponible para persistencia.
 */
export interface PayPalCapturedOrder {
  /** Identificador del proveedor para la orden capturada. */
  orderId: string;
  status: string;
  /** Identificador `CAPTURE-…`; si falta se considera respuesta inválida aguas abajo. */
  captureId: string | null;
  captureStatus: string | null;
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

/** Resultado del reembolso de una captura (SF3-09). */
export interface PayPalRefundedCapture {
  /** Identificador `REFUND-…` de la devolución. */
  refundId: string;
  /** Estado del proveedor (p. ej. COMPLETED). */
  status: string;
  raw: Record<string, unknown>;
}

export interface PayPalRefundCommand {
  /** Capture-id del proveedor sobre el que se devuelve dinero. */
  captureId: string;
  /** Importe a reembolsar en unidad mínima; omitir = reembolso total. */
  amountMinor?: string;
  currency: string;
  /** Motivo obligatorio; viaja como `note_to_payer` para el pagador. */
  reason: string;
  /** PayPal-Request-Id determinista para idempotencia ante reintentos. */
  requestId: string;
}

/**
 * Verificación de la firma de un webhook PayPal vía
 * `POST /v1/notifications/verify-webhook-signature`. `verified=false` SIEMPRE
 * debe traducirse en 401 sin modificar datos (fail-closed, SF3-09).
 */
export interface PayPalWebhookVerification {
  verified: boolean;
  /** Motivo del fallo cuando `verified=false`; ausente si la firma es válida. */
  reason?:
    | 'webhook_id_not_configured'
    | 'invalid_event_body'
    | 'missing_transmission_headers'
    | 'provider_error'
    | 'signature_invalid';
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
@Injectable()
export class PayPalClient {
  private readonly logger = new Logger(PayPalClient.name);
  private readonly mode: PayPalMode;
  private readonly timeoutMs: number;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  /** Webhook id registrado en PayPal para verificar firmas (SF3-09, fail-closed). */
  private readonly webhookId: string | undefined;
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
    this.webhookId = config.get<string>('PAYPAL_WEBHOOK_ID');
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

  /**
   * Captura una orden previamente aprobada por el pagador (`SF3-09`).
   * El endpoint del proveedor se invoca con `PayPal-Request-Id` derivado de la
   * clave de idempotencia de la orden para cubrir reintentos de transporte.
   *
   * DECISIÓN (SF3-09): la API Orders v2 de PayPal no admite capturas
   * parciales — el cuerpo de `POST /v2/checkout/orders/{id}/capture` debe ir
   * vacío; las capturas parciales solo existen sobre *autorizaciones*
   * (inten AUTHORIZE), flujo no usado en #78. Ante un importe parcial
   * solicitado, el proveedor recibe la captura TOTAL y finance-service
   * registra el importe parcial en `captured_amount_minor`, dejando la
   * divergencia documentada en `provider_response` para su conciliación en
   * SF3-10. Si el API lo permitiera en el futuro, este método es el único
   * punto donde añadir el parámetro `amount`.
   */
  async captureOrder(paypalOrderId: string, requestId: string): Promise<PayPalCapturedOrder> {
    const accessToken = await this.accessToken();

    const response = await this.request(
      'POST',
      `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      accessToken,
      JSON.stringify({}),
      { 'PayPal-Request-Id': requestId },
    );

    if (!response.ok) {
      throw this.toProviderError(response.status);
    }

    return this.parseCapturedOrder(await response.text());
  }

  /**
   * Reembolsa (total o parcial) una captura vía `POST /v2/payments/captures/
   * {capture_id}/refund` (SF3-09). El amount  sí es admitido por el proveedor
   * aquí, así que el reembolso parcial es exacto; el motivo viaja como
   * `note_to_payer` y el `requestId` determinista evita dobles devoluciones
   * ante reintentos de transporte.
   */
  async refundCapture(command: PayPalRefundCommand): Promise<PayPalRefundedCapture> {
    const accessToken = await this.accessToken();

    const body: Record<string, unknown> = { note_to_payer: command.reason };
    if (command.amountMinor !== undefined) {
      try {
        body.amount = {
          currency_code: command.currency,
          value: minorToPayPalDecimal(command.amountMinor, command.currency),
        };
      } catch {
        throw new PayPalClientError(
          'PAYPAL_INVALID_RESPONSE',
          'El importe del reembolso no es representable en la moneda indicada',
        );
      }
    }

    const response = await this.request(
      'POST',
      `${this.baseUrl}/v2/payments/captures/${encodeURIComponent(command.captureId)}/refund`,
      accessToken,
      JSON.stringify(body),
      { 'PayPal-Request-Id': command.requestId },
    );

    if (!response.ok) {
      throw this.toProviderError(response.status);
    }

    return this.parseRefundedCapture(await response.text());
  }

  /**
   * Verifica la firma de una notificación webhook contra el API del proveedor
   * (`/v1/notifications/verify-webhook-signature`, SF3-09). Fail-closed: sin
   * `PAYPAL_WEBHOOK_ID`, sin cabeceras de transmisión o con un body no
   * interpretable devuelve `verified: false` y el llamador debe responder 401
   * sin tocar datos.
   */
  async verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<PayPalWebhookVerification> {
    if (!this.webhookId || this.webhookId.trim().length === 0) {
      return { verified: false, reason: 'webhook_id_not_configured' };
    }

    const transmissionId = PayPalClient.headerOf(headers, 'PayPal-Transmission-Id');
    const transmissionTime = PayPalClient.headerOf(headers, 'PayPal-Transmission-Time');
    const certUrl = PayPalClient.headerOf(headers, 'PayPal-Cert-Url');
    const authAlgo = PayPalClient.headerOf(headers, 'PayPal-Auth-Algo');
    const transmissionSig = PayPalClient.headerOf(headers, 'PayPal-Transmission-Sig');

    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
      return { verified: false, reason: 'missing_transmission_headers' };
    }

    const parsedEvent = this.parseJson(rawBody);
    if (!parsedEvent) {
      return { verified: false, reason: 'invalid_event_body' };
    }

    let accessToken: string;
    try {
      accessToken = await this.accessToken();
    } catch {
      // Sin credenciales OAuth no hay soporte para verificar: fail-closed.
      return { verified: false, reason: 'provider_error' };
    }

    const body = {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: this.webhookId,
      webhook_event: parsedEvent,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { verified: false, reason: 'provider_error' };
    }

    if (!response.ok) {
      return { verified: false, reason: 'provider_error' };
    }

    const parsed = this.parseJson(await response.text());
    const status =
      typeof parsed?.verification_status === 'string' ? parsed.verification_status : '';
    return status === 'SUCCESS'
      ? { verified: true }
      : { verified: false, reason: 'signature_invalid' };
  }

  /** Búsqueda de cabecera insensible a mayúsculas (los proxies varían el caso). */
  private static headerOf(headers: Record<string, string>, name: string): string | undefined {
    const normalized = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === normalized && typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
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
      'El proveedor de pagos rechazó la operación',
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

  /**
   * Extrae el capture-id de una respuesta de captura de orden: el proveedor
   * lo anida en `purchase_units[0].payments.captures[0]`. Una respuesta sin
   * captura legible es `PAYPAL_INVALID_RESPONSE` (nunca se marca CAPTURED sin
   * capture_id, SF3-09).
   */
  private parseCapturedOrder(text: string): PayPalCapturedOrder {
    const parsed = this.parseJson(text);
    const orderId = typeof parsed?.id === 'string' ? parsed.id : undefined;
    const status = typeof parsed?.status === 'string' ? parsed.status : undefined;

    const capture = this.firstCaptureOf(parsed);
    if (!orderId || !status || !capture?.id) {
      this.logger.warn('Respuesta de captura sin identificador de captura');
      throw new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'El proveedor de pagos devolvió una captura sin identificador',
      );
    }

    const raw = this.isPlainObject(parsed) ? parsed : ({} as Record<string, unknown>);
    return {
      orderId,
      status,
      captureId: capture.id,
      captureStatus: capture.status ?? null,
      raw,
    };
  }

  private firstCaptureOf(
    value: Record<string, unknown> | null,
  ): { id?: string; status?: string } | null {
    const purchaseUnits = value?.purchase_units;
    if (!Array.isArray(purchaseUnits) || purchaseUnits.length === 0) {
      return null;
    }

    const unit = purchaseUnits[0];
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      return null;
    }

    const payments = (unit as Record<string, unknown>).payments;
    if (!payments || typeof payments !== 'object') {
      return null;
    }

    const captures = (payments as Record<string, unknown>).captures;
    if (!Array.isArray(captures) || captures.length === 0) {
      return null;
    }

    const capture = captures[0];
    if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
      return null;
    }

    const record = capture as Record<string, unknown>;
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      status: typeof record.status === 'string' ? record.status : undefined,
    };
  }

  private parseRefundedCapture(text: string): PayPalRefundedCapture {
    const parsed = this.parseJson(text);
    const refundId = typeof parsed?.id === 'string' ? parsed.id : undefined;
    const status = typeof parsed?.status === 'string' ? parsed.status : undefined;

    if (!refundId || !status) {
      this.logger.warn('Respuesta de reembolso sin identificador');
      throw new PayPalClientError(
        'PAYPAL_INVALID_RESPONSE',
        'El proveedor de pagos devolvió un reembolso sin identificador',
      );
    }

    const raw = this.isPlainObject(parsed) ? parsed : ({} as Record<string, unknown>);
    return { refundId, status, raw };
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

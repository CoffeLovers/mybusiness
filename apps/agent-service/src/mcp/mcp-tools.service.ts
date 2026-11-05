import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { TimeoutError, firstValueFrom } from 'rxjs';
import {
  CashflowPatterns,
  LedgerPatterns,
  McpErrorCodes,
  PaymentsPatterns,
  PAYMENTS_WRITE_ROLES,
  type CreatePaymentLinkResult,
  type McpCallToolResult,
  type McpInvocationContext,
  type McpToolName,
  type McpToolsListResult,
  type PayPalOrderView,
} from '@mybusiness/contracts';
import { rpcSend } from '@mybusiness/common';
import { McpAuditPublisher } from './mcp-audit.publisher';
import { MCP_SCHEMA_VERSION, MCP_TOOLS, validateToolArguments } from './tool-schemas';

/** Token de inyección del limitador de invocaciones. */
export const MCP_RATE_LIMITER = 'MCP_RATE_LIMITER';

/** Timeout máximo por invocación RPC hacia finance-service. */
const TOOL_TIMEOUT_MS = 5000;

/** Limitador de ventana fija: devuelve `false` cuando se excede la cuota. */
export interface RateLimiter {
  consume(key: string): Promise<boolean>;
}

/** Error de herramienta con código estable y estatus HTTP sugerido. */
export class McpToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

interface RpcErrorLike {
  statusCode?: unknown;
  status?: unknown;
}

@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);

  constructor(
    @Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy,
    private readonly auditPublisher: McpAuditPublisher,
    private readonly config: ConfigService,
    @Inject(MCP_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

  private get rateLimit(): number {
    const configured = Number(this.config.get<string | number>('MCP_RATE_LIMIT_PER_MINUTE', 60));
    return Number.isFinite(configured) && configured > 0 ? configured : 60;
  }

  async listTools(): Promise<McpToolsListResult> {
    return { tools: MCP_TOOLS, schemaVersion: MCP_SCHEMA_VERSION };
  }

  /**
   * Ejecuta una herramienta de solo lectura con validación estricta, control de
   * cuota por tenant y una única auditoría por invocación (éxito o error).
   */
  async call(
    name: McpToolName,
    args: Record<string, unknown>,
    ctx: McpInvocationContext,
  ): Promise<McpCallToolResult> {
    const startedAt = Date.now();
    let ok = false;
    let errorCode: string | undefined;
    let resultSize: number | undefined;

    try {
      if (!(await this.consumeQuota(ctx))) {
        this.logger.warn(`Rate limit MCP excedido (${this.rateLimit} invocaciones por minuto)`);
        throw new McpToolError(
          McpErrorCodes.RATE_LIMITED,
          'Límite de invocaciones excedido',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const validation = validateToolArguments(name, args);
      if (!validation.ok) {
        throw new McpToolError(
          McpErrorCodes.TOOL_INVALID_INPUT,
          validation.issues.join('; '),
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = await this.executeTool(name, validation.value as Record<string, unknown>, ctx);

      resultSize = this.resultSize(data);
      ok = true;

      return { tool: name, schemaVersion: MCP_SCHEMA_VERSION, data };
    } catch (error) {
      const toolError = this.toToolError(error);
      errorCode = toolError.code;
      throw toolError;
    } finally {
      await this.auditPublisher.publish({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: ctx.role,
        tool: name,
        ok,
        latencyMs: Date.now() - startedAt,
        errorCode,
        resultSize,
      });
    }
  }

  private async consumeQuota(ctx: McpInvocationContext): Promise<boolean> {
    try {
      return await this.rateLimiter.consume(`mcp:${ctx.tenantId}`);
    } catch (error) {
      // Fail-open: un fallo del limitador nunca debe bloquear la herramienta.
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Limitador MCP no disponible, se continúa sin cuota: ${errorName}`);
      return true;
    }
  }

  private async executeTool(
    name: McpToolName,
    args: Record<string, unknown>,
    ctx: McpInvocationContext,
  ): Promise<unknown> {
    const context = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: ctx.role,
    };

    if (name === 'get_cashflow_summary') {
      return firstValueFrom(
        rpcSend<unknown, Record<string, unknown>>(
          this.financeClient,
          CashflowPatterns.SUMMARY,
          { ...args, ...context },
          TOOL_TIMEOUT_MS,
        ),
      );
    }

    if (name === 'create_payment_link') {
      return this.createPaymentLink(args, ctx);
    }

    return firstValueFrom(
      rpcSend<unknown, Record<string, unknown>>(
        this.financeClient,
        LedgerPatterns.LIST,
        { ...args, reconciliationStatus: 'UNMATCHED', ...context },
        TOOL_TIMEOUT_MS,
      ),
    );
  }

  /**
   * `create_payment_link` es la primera herramienta de escritura del servidor
   * MCP: exige permiso de cobro (`payments:write`) resuelto por el servidor a
   * partir del sobre RPC, nunca por el modelo (ADR 008). Devuelve el enlace de
   * checkout sin exponer detalles del proveedor.
   */
  private async createPaymentLink(
    args: Record<string, unknown>,
    ctx: McpInvocationContext,
  ): Promise<CreatePaymentLinkResult> {
    if (!PAYMENTS_WRITE_ROLES.some((role) => role === ctx.role)) {
      throw new McpToolError(
        McpErrorCodes.TOOL_FORBIDDEN,
        'No está autorizado para crear enlaces de cobro',
        HttpStatus.FORBIDDEN,
      );
    }

    const amountMinor = typeof args.amountMinor === 'string' ? args.amountMinor : undefined;
    const currency = typeof args.currency === 'string' ? args.currency : undefined;
    const invoiceId = typeof args.invoiceId === 'string' ? args.invoiceId : undefined;

    if (!amountMinor || !currency || !invoiceId) {
      throw new McpToolError(
        McpErrorCodes.TOOL_INVALID_INPUT,
        'amountMinor, currency e invoiceId son obligatorios',
        HttpStatus.BAD_REQUEST,
      );
    }

    const order = await firstValueFrom(
      rpcSend<PayPalOrderView, Record<string, unknown>>(
        this.financeClient,
        PaymentsPatterns.PAYPAL_CREATE_ORDER,
        {
          amountMinor,
          currency,
          invoiceRef: invoiceId,
          description:
            typeof args.description === 'string' && args.description.length > 0
              ? args.description
              : 'Cobro mediante enlace de pago',
          idempotencyKey:
            typeof args.idempotencyKey === 'string' && args.idempotencyKey.length > 0
              ? args.idempotencyKey
              : `mcp:${ctx.requestId}`,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          role: ctx.role,
        },
        TOOL_TIMEOUT_MS,
      ),
    );

    return {
      paypalOrderId: order.paypalOrderId,
      status: order.status,
      checkoutUrl: order.checkoutUrl,
      amountMinor: order.amountMinor,
      currency: order.currency,
    };
  }

  private toToolError(error: unknown): McpToolError {
    if (error instanceof McpToolError) {
      return error;
    }

    if (this.isTimeout(error)) {
      return new McpToolError(
        McpErrorCodes.TOOL_TIMEOUT,
        'La herramienta devolvió tiempo de espera agotado',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    if (this.httpStatusOf(error) === HttpStatus.FORBIDDEN) {
      return new McpToolError(
        McpErrorCodes.TOOL_FORBIDDEN,
        'No está autorizado para invocar esta herramienta',
        HttpStatus.FORBIDDEN,
      );
    }

    return new McpToolError(
      McpErrorCodes.TOOL_UNAVAILABLE,
      'La herramienta no está disponible en este momento',
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * `rpcSend` traduce el `TimeoutError` de RxJS a un 503; se reconoce también
   * la forma nativa para cubrir clientes que no pasan por ese wrapper.
   */
  private isTimeout(error: unknown): boolean {
    if (error instanceof TimeoutError) {
      return true;
    }

    if (error instanceof HttpException) {
      return error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE;
    }

    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as { name?: unknown };
    return candidate.name === 'TimeoutError';
  }

  private httpStatusOf(error: unknown): number | null {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (!error || typeof error !== 'object') {
      return null;
    }

    const candidate = error as RpcErrorLike;
    const status = candidate.statusCode ?? candidate.status;
    return typeof status === 'number' ? status : null;
  }

  private resultSize(data: unknown): number | undefined {
    if (Array.isArray(data)) {
      return data.length;
    }

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      for (const key of ['items', 'transactions', 'rows', 'data']) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value.length;
        }
      }
    }

    return undefined;
  }
}

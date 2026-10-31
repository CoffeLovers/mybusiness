import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { BankConnectionStatus, BankProvider } from '../enums';
import type { RequestContext, WithContext } from './context.dto';

export class StartBankConnectionDto {
  @IsEnum(BankProvider)
  provider!: BankProvider;

  @IsString()
  @IsOptional()
  institutionId?: string;
}

export class ExchangeBankConnectionDto {
  @IsEnum(BankProvider)
  provider!: BankProvider;

  /** Token público retornado por el widget de Plaid Link. */
  @IsString()
  @IsOptional()
  publicToken?: string;

  /** Identificador de la institución o link en Belvo (u otros proveedores). */
  @IsString()
  @IsOptional()
  institution?: string;

  /** Identificador de link/conexión devuelto por widgets alternativos (e.g. Belvo widget). */
  @IsString()
  @IsOptional()
  linkId?: string;

  /** Metadatos adicionales opcionales enviados por el frontend (institución, cuentas seleccionadas, etc.). */
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export interface BankConnectionResponse {
  id: string;
  provider: BankProvider;
  institutionId?: string | null;
  institutionName?: string | null;
  status: BankConnectionStatus;
  lastSuccessfulSyncAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountResponse {
  id: string;
  connectionId: string;
  providerAccountId: string;
  name: string;
  officialName?: string | null;
  type?: string | null;
  subtype?: string | null;
  mask?: string | null;
  isoCurrencyCode: string;
  balanceCurrentMinor?: string | null;
  balanceAvailableMinor?: string | null;
  status?: string | null;
}

export interface BankTransactionResponse {
  id: string;
  accountId: string;
  providerTransactionId: string;
  amountMinor: string;
  isoCurrencyCode: string;
  date: string;
  authorizedDate?: string | null;
  name: string;
  merchantName?: string | null;
  category?: string[] | null;
  pending: boolean;
}

export interface StartBankConnectionResponse {
  provider: BankProvider;
  linkToken?: string;
  expiration?: string;
  [key: string]: unknown;
}

export interface SyncConnectionResponse {
  connectionId: string;
  added: number;
  modified: number;
  removed: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

/** DTOs / Payloads para llamadas RPC internas hacia finance-service */
export type StartBankConnectionRpcPayload = WithContext<StartBankConnectionDto>;
export type ExchangeBankConnectionRpcPayload = WithContext<ExchangeBankConnectionDto>;
export type GetBankConnectionsRpcPayload = RequestContext;

export class ConnectionIdParamDto {
  @IsString()
  @IsNotEmpty()
  connectionId!: string;
}

export type GetBankConnectionAccountsRpcPayload = WithContext<ConnectionIdParamDto>;
export type SyncBankConnectionRpcPayload = WithContext<ConnectionIdParamDto>;
export type DisconnectBankConnectionRpcPayload = WithContext<ConnectionIdParamDto>;

export interface BankWebhookRpcPayload {
  provider: BankProvider;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

import type { CashflowSummaryResponse } from '../dtos/cashflow.dto';
import type { LedgerPageResponse } from '../dtos/ledger.dto';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SERVER_NAME = 'mybusiness-internal';
export const MCP_SERVER_VERSION = '1.0.0';

export type McpToolName =
  'get_cashflow_summary' | 'list_unreconciled_transactions' | 'create_payment_link';

export const MCP_TOOL_NAMES: readonly McpToolName[] = [
  'get_cashflow_summary',
  'list_unreconciled_transactions',
  'create_payment_link',
];

export const McpErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TOOL_INVALID_INPUT: 'TOOL_INVALID_INPUT',
  TOOL_FORBIDDEN: 'TOOL_FORBIDDEN',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_UNAVAILABLE: 'TOOL_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: { code: string; details?: string };
}

export interface McpJsonRpcSuccess<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result: T;
}

export interface McpJsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: McpJsonRpcError;
}

export type McpJsonRpcResponse<T = unknown> = McpJsonRpcSuccess<T> | McpJsonRpcFailure;

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: { tools: { listChanged: false } };
}

export interface McpToolDescriptor {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Versión del contrato de la herramienta (semver). */
  version: string;
}

export interface McpToolsListResult {
  tools: McpToolDescriptor[];
  schemaVersion: string;
}

export interface McpCallToolParams {
  name: McpToolName;
  arguments?: Record<string, unknown>;
}

export interface McpCallToolResult<T = unknown> {
  tool: McpToolName;
  schemaVersion: string;
  data: T;
}

export interface GetCashflowSummaryArgs {
  from: string;
  to: string;
  currency?: string;
}
export type GetCashflowSummaryResult = CashflowSummaryResponse;

export interface ListUnreconciledArgs {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  accountId?: string;
}
export type ListUnreconciledResult = LedgerPageResponse;

/** Contexto de invocación: siempre resuelto por el servidor, nunca por el modelo. */
export interface McpInvocationContext {
  tenantId: string;
  userId: string;
  role: string;
  requestId: string;
}

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  McpErrorCodes,
  McpPatterns,
  type McpInitializeResult,
  type McpJsonRpcError,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type WithContext,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { McpToolError, McpToolsService } from './mcp-tools.service';
import { McpToolNameSchema } from './tool-schemas';

/** Payload RPC: la solicitud JSON-RPC viaja junto al contexto multi-tenant. */
export type McpRpcPayload = WithContext<McpJsonRpcRequest>;

const CallToolParamsSchema = z
  .object({
    name: McpToolNameSchema,
    arguments: z.record(z.unknown()).optional(),
  })
  .strict();

const TOOL_ERROR_JSON_RPC_CODE = -32000;

function failure(code: number, message: string): McpJsonRpcError {
  return { code, message };
}

@Controller()
export class McpController {
  constructor(private readonly tools: McpToolsService) {}

  @MessagePattern(McpPatterns.RPC)
  async handle(@Payload() data: McpRpcPayload): Promise<McpJsonRpcResponse> {
    const ctx = extractRpcContext(data);
    const request = stripRpcContext(data) as unknown as McpJsonRpcRequest;
    const id = this.normalizedId(request?.id);

    if (!this.isRequestShapeValid(request)) {
      return {
        jsonrpc: '2.0',
        id,
        error: failure(McpErrorCodes.INVALID_REQUEST, 'Solicitud JSON-RPC inválida'),
      };
    }

    const requestId = id === null ? randomUUID() : String(id);
    const invocationContext = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: ctx.role,
      requestId,
    };

    switch (request.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: this.initializeResult() };

      case 'tools/list': {
        const result = await this.tools.listTools();
        return { jsonrpc: '2.0', id, result };
      }

      case 'tools/call': {
        const parsed = CallToolParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return {
            jsonrpc: '2.0',
            id,
            error: failure(McpErrorCodes.INVALID_PARAMS, 'Parámetros inválidos para tools/call'),
          };
        }

        try {
          const result = await this.tools.call(
            parsed.data.name,
            parsed.data.arguments ?? {},
            invocationContext,
          );
          return { jsonrpc: '2.0', id, result };
        } catch (error) {
          if (error instanceof McpToolError) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: TOOL_ERROR_JSON_RPC_CODE,
                message: error.message,
                data: { code: error.code },
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            error: failure(McpErrorCodes.INTERNAL_ERROR, 'Error interno del servidor MCP'),
          };
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: failure(McpErrorCodes.METHOD_NOT_FOUND, 'Método no soportado'),
        };
    }
  }

  private initializeResult(): McpInitializeResult {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      capabilities: { tools: { listChanged: false } },
    };
  }

  private normalizedId(value: unknown): string | number | null {
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    return null;
  }

  private isRequestShapeValid(request: unknown): request is McpJsonRpcRequest {
    if (!request || typeof request !== 'object') {
      return false;
    }

    const candidate = request as Partial<McpJsonRpcRequest>;
    if (candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string') {
      return false;
    }

    const id = candidate.id;
    return typeof id === 'string' || typeof id === 'number' || id === null || id === undefined;
  }
}

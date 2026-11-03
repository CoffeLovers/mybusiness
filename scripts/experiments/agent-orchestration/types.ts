/**
 * Tipos e interfaces estables para el prototipo de orquestación de agentes.
 * Define el contrato inmutable de herramientas (Tool Interface) y telemetría.
 */

export interface ToolContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  traceId: string;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  executionTimeMs: number;
  citation: string;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  timeoutMs: number;
  auditAction: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON serializado
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  message: ChatMessage;
  usage: LLMUsage;
  latencyMs: number;
}

export interface Span {
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
}

export interface OrchestrationResult {
  content: string;
  citations: string[];
  toolCallsCount: number;
  totalDurationMs: number;
  totalTokens: LLMUsage;
  estimatedCostUSD: number;
  spans: Span[];
  error?: {
    code: string;
    message: string;
    degraded: boolean;
  };
}

export interface ScenarioMetricSummary {
  scenarioName: string;
  totalRuns: number;
  successRuns: number;
  degradedRuns: number;
  failedRuns: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgCostUSD: number;
  toolCallsPerTurn: number;
}

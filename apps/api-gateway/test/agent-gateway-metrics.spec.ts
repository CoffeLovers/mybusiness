import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { EventEmitter } from 'node:events';
import { AgentGatewayController } from '../src/agent/agent-gateway.controller';
import { AgentPatterns, UserRole, type UserContext } from '@mybusiness/contracts';
import {
  agentMetrics,
  METRIC_AGENT_FIRST_TOKEN_MS,
  METRIC_AGENT_STREAM_DURATION_MS,
  METRIC_AGENT_REQUESTS_TOTAL,
  METRIC_AGENT_CANCELLATIONS_TOTAL,
  METRIC_AGENT_ERRORS_TOTAL,
} from '@mybusiness/telemetry';

describe('AgentGatewayController Observability & Metrics (SF4-12, #65)', () => {
  let controller: AgentGatewayController;
  let mockAgentClient: any;

  const mockUser: UserContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: UserRole.ACCOUNTANT,
  };

  beforeEach(() => {
    agentMetrics.clear();
    mockAgentClient = {
      send: vi.fn(),
    };
    controller = new AgentGatewayController(mockAgentClient);
  });

  describe('chat()', () => {
    it('propagates x-mybusiness-channel header to RPC payload', () => {
      mockAgentClient.send.mockReturnValue(of({ answer: 'ok' }));

      const req: any = {
        headers: { 'x-mybusiness-channel': 'android' },
      };

      controller.chat(mockUser, { message: 'Hola' }, req);

      expect(mockAgentClient.send).toHaveBeenCalledWith(
        AgentPatterns.CHAT,
        expect.objectContaining({
          message: 'Hola',
          tenantId: mockUser.tenantId,
          channel: 'android',
        }),
      );
    });

    it('defaults channel to web when header is absent', () => {
      mockAgentClient.send.mockReturnValue(of({ answer: 'ok' }));

      const req: any = {
        headers: {},
      };

      controller.chat(mockUser, { message: 'Hola' }, req);

      expect(mockAgentClient.send).toHaveBeenCalledWith(
        AgentPatterns.CHAT,
        expect.objectContaining({
          channel: 'web',
        }),
      );
    });
  });

  describe('chatStream()', () => {
    it('records first_token_ms, stream_duration_ms and request metric on successful stream', async () => {
      const chatResponse = {
        answer: 'Flujo de caja verificado',
        citations: [],
        degraded: false,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          costMicroUsd: 100,
          budgetRemainingMicroUsd: 9000,
          cacheHit: false,
        },
      };
      mockAgentClient.send.mockReturnValue(of(chatResponse));

      const req: any = new EventEmitter();
      req.headers = { 'x-mybusiness-channel': 'web' };

      const written: string[] = [];
      const res: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => written.push(chunk)),
        end: vi.fn(() => {
          res.writableEnded = true;
        }),
        writableEnded: false,
      };

      await controller.chatStream(mockUser, { message: 'Hola' }, req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );
      expect(res.end).toHaveBeenCalled();

      const recorded = agentMetrics.getRecordedMetrics();
      const firstTokenMetric = recorded.find((m) => m.metric === METRIC_AGENT_FIRST_TOKEN_MS);
      const streamDurationMetric = recorded.find(
        (m) => m.metric === METRIC_AGENT_STREAM_DURATION_MS,
      );
      const requestMetric = recorded.find((m) => m.metric === METRIC_AGENT_REQUESTS_TOTAL);

      expect(firstTokenMetric).toBeDefined();
      expect(firstTokenMetric?.attributes.channel).toBe('web');
      expect(firstTokenMetric?.attributes.streaming).toBe(true);

      expect(streamDurationMetric).toBeDefined();
      expect(streamDurationMetric?.attributes.channel).toBe('web');

      expect(requestMetric).toBeDefined();
      expect(requestMetric?.attributes.status).toBe('success');
    });

    it('records cancellation metric when client disconnects before stream ends', async () => {
      let triggerClose: () => void = () => {};
      mockAgentClient.send.mockImplementation(() => {
        return {
          subscribe: () => {
            triggerClose();
          },
        };
      });

      const req: any = new EventEmitter();
      req.headers = { 'x-mybusiness-channel': 'android' };

      const res: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        writableEnded: false,
      };

      triggerClose = () => {
        req.emit('close');
      };

      // Call chatStream, it sets up req.on('close')
      void controller.chatStream(mockUser, { message: 'Hola' }, req, res);
      req.emit('close');

      const recorded = agentMetrics.getRecordedMetrics();
      const cancellationMetric = recorded.find(
        (m) => m.metric === METRIC_AGENT_CANCELLATIONS_TOTAL,
      );

      expect(cancellationMetric).toBeDefined();
      expect(cancellationMetric?.attributes.channel).toBe('android');
      expect(cancellationMetric?.attributes.streaming).toBe(true);
    });

    it('records error metric when streaming fails', async () => {
      mockAgentClient.send.mockReturnValue(throwError(() => new Error('LLM timeout')));

      const req: any = new EventEmitter();
      req.headers = { 'x-mybusiness-channel': 'web' };

      const written: string[] = [];
      const res: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => written.push(chunk)),
        end: vi.fn(() => {
          res.writableEnded = true;
        }),
        writableEnded: false,
      };

      await controller.chatStream(mockUser, { message: 'Hola' }, req, res);

      expect(res.end).toHaveBeenCalled();
      const recorded = agentMetrics.getRecordedMetrics();
      const errorMetric = recorded.find((m) => m.metric === METRIC_AGENT_ERRORS_TOTAL);

      expect(errorMetric).toBeDefined();
      expect(errorMetric?.attributes.channel).toBe('web');
      expect(errorMetric?.attributes.status).toBe('error');
    });
  });

  describe('getSlos()', () => {
    it('returns SLO compliance status from agentMetrics', () => {
      agentMetrics.recordFirstToken(500, { channel: 'web', streaming: true });
      agentMetrics.recordRequest({ channel: 'web', streaming: true });

      const slos = controller.getSlos('web');
      expect(slos).toEqual(
        expect.objectContaining({
          firstTokenP95Ms: 500,
          firstTokenSloBreached: false,
          errorRate: 0,
          errorRateSloBreached: false,
        }),
      );
    });
  });
});

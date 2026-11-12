import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentMetrics,
  METRIC_AGENT_FIRST_TOKEN_MS,
  METRIC_AGENT_STREAM_DURATION_MS,
  METRIC_AGENT_REQUESTS_TOTAL,
  METRIC_AGENT_CANCELLATIONS_TOTAL,
  METRIC_AGENT_ERRORS_TOTAL,
  SLO_FIRST_TOKEN_P95_MS,
} from '../src/agent-metrics';

describe('AgentMetrics & SLOs (SF4-12, #65)', () => {
  beforeEach(() => {
    agentMetrics.clear();
  });

  describe('Anti-PII attribute sanitization', () => {
    it('only keeps allowed attributes (channel, tenantId, streaming, status) and discards PII', () => {
      const sanitized = agentMetrics.sanitizeAttributes({
        channel: 'android',
        tenantId: '11111111-1111-4111-8111-111111111111',
        streaming: true,
        status: 'success',
        // Intentional PII injection attempts:
        ...({
          prompt: '¿Cuánto dinero tiene Juan Pérez?',
          message: 'Dime el balance de la cuenta',
          email: 'usuario@empresa.com',
          userContent: 'Confidencial',
        } as any),
      });

      expect(sanitized).toEqual({
        channel: 'android',
        tenantId: '11111111-1111-4111-8111-111111111111',
        streaming: true,
        status: 'success',
      });
      expect((sanitized as any).prompt).toBeUndefined();
      expect((sanitized as any).message).toBeUndefined();
      expect((sanitized as any).email).toBeUndefined();
    });

    it('defaults channel to web if missing or invalid', () => {
      const sanitized = agentMetrics.sanitizeAttributes({
        channel: undefined as any,
        streaming: false,
      });
      expect(sanitized.channel).toBe('web');
      expect(sanitized.streaming).toBe(false);
    });
  });

  describe('Metric recording', () => {
    it('records first token latency histogram entry', () => {
      agentMetrics.recordFirstToken(350, {
        channel: 'web',
        tenantId: 'tenant-123',
        streaming: true,
      });

      const recorded = agentMetrics.getRecordedMetrics();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].metric).toBe(METRIC_AGENT_FIRST_TOKEN_MS);
      expect(recorded[0].value).toBe(350);
      expect(recorded[0].attributes.channel).toBe('web');
      expect(recorded[0].attributes.tenantId).toBe('tenant-123');
      expect(recorded[0].attributes.streaming).toBe(true);
    });

    it('records stream duration histogram entry', () => {
      agentMetrics.recordStreamDuration(1200, {
        channel: 'android',
        tenantId: 'tenant-123',
        streaming: false,
      });

      const recorded = agentMetrics.getRecordedMetrics();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].metric).toBe(METRIC_AGENT_STREAM_DURATION_MS);
      expect(recorded[0].value).toBe(1200);
      expect(recorded[0].attributes.channel).toBe('android');
    });

    it('records request counter entry with status=success', () => {
      agentMetrics.recordRequest({
        channel: 'web',
        streaming: true,
      });

      const recorded = agentMetrics.getRecordedMetrics();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].metric).toBe(METRIC_AGENT_REQUESTS_TOTAL);
      expect(recorded[0].attributes.status).toBe('success');
    });

    it('records cancellation counter entry with status=cancelled', () => {
      agentMetrics.recordCancellation({
        channel: 'web',
        streaming: true,
      });

      const recorded = agentMetrics.getRecordedMetrics();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].metric).toBe(METRIC_AGENT_CANCELLATIONS_TOTAL);
      expect(recorded[0].attributes.status).toBe('cancelled');
    });

    it('records error counter entry with status=error', () => {
      agentMetrics.recordError({
        channel: 'android',
        streaming: false,
      });

      const recorded = agentMetrics.getRecordedMetrics();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].metric).toBe(METRIC_AGENT_ERRORS_TOTAL);
      expect(recorded[0].attributes.status).toBe('error');
    });
  });

  describe('SLO Evaluation', () => {
    it('evaluates healthy SLO compliance when latency and errors are within bounds', () => {
      // 10 successful requests with p95 < 2000ms
      for (let i = 1; i <= 20; i++) {
        const latency = 100 + i * 50; // 150ms to 1100ms
        agentMetrics.recordFirstToken(latency, { channel: 'web', streaming: true });
        agentMetrics.recordRequest({ channel: 'web', streaming: true });
      }

      const slos = agentMetrics.evaluateSlos('web');
      expect(slos.firstTokenP95Ms).toBeLessThanOrEqual(SLO_FIRST_TOKEN_P95_MS);
      expect(slos.firstTokenSloBreached).toBe(false);
      expect(slos.errorRate).toBe(0);
      expect(slos.errorRateSloBreached).toBe(false);
    });

    it('detects first token latency SLO breach when p95 exceeds 2000ms', () => {
      for (let i = 1; i <= 10; i++) {
        agentMetrics.recordFirstToken(2500, { channel: 'web', streaming: true });
        agentMetrics.recordRequest({ channel: 'web', streaming: true });
      }

      const slos = agentMetrics.evaluateSlos('web');
      expect(slos.firstTokenP95Ms).toBe(2500);
      expect(slos.firstTokenSloBreached).toBe(true);
    });

    it('detects error rate SLO breach when error rate exceeds 2%', () => {
      // 90 success, 10 errors => 10% error rate (> 2%)
      for (let i = 0; i < 90; i++) {
        agentMetrics.recordRequest({ channel: 'android', streaming: false });
      }
      for (let i = 0; i < 10; i++) {
        agentMetrics.recordError({ channel: 'android', streaming: false });
      }

      const slos = agentMetrics.evaluateSlos('android');
      expect(slos.errorRate).toBe(0.1);
      expect(slos.errorRateSloBreached).toBe(true);
    });

    it('isolates SLO evaluation per channel', () => {
      // Web is fast and healthy
      agentMetrics.recordFirstToken(500, { channel: 'web', streaming: true });
      agentMetrics.recordRequest({ channel: 'web', streaming: true });

      // Android is slow and breaching
      agentMetrics.recordFirstToken(3000, { channel: 'android', streaming: true });
      agentMetrics.recordRequest({ channel: 'android', streaming: true });

      const webSlos = agentMetrics.evaluateSlos('web');
      expect(webSlos.firstTokenSloBreached).toBe(false);

      const androidSlos = agentMetrics.evaluateSlos('android');
      expect(androidSlos.firstTokenSloBreached).toBe(true);
    });
  });
});

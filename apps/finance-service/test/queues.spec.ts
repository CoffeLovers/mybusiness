import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  buildJobId,
  dlqName,
  resolveConcurrency,
  resolveShutdownTimeoutMs,
} from '@mybusiness/common';

describe('queues (utilidades de BullMQ)', () => {
  describe('buildJobId', () => {
    it('es determinista para la misma cola y clave', () => {
      const first = buildJobId('banking-sync', 'tenant:1:item:2');
      const second = buildJobId('banking-sync', 'tenant:1:item:2');

      expect(first).toBe(second);
    });

    it('genera 32 caracteres hexadecimales', () => {
      expect(buildJobId('banking-sync', 'tenant:1:item:2')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('difiere para otra clave de negocio', () => {
      const first = buildJobId('banking-sync', 'tenant:1:item:2');
      const second = buildJobId('banking-sync', 'tenant:1:item:3');

      expect(first).not.toBe(second);
    });

    it('lanza si la clave está vacía', () => {
      expect(() => buildJobId('banking-sync', '')).toThrow();
      expect(() => buildJobId('banking-sync', '   ')).toThrow();
    });
  });

  describe('resolveConcurrency', () => {
    it('usa el override específico de la cola', () => {
      expect(resolveConcurrency('banking-sync', { QUEUE_CONCURRENCY_BANKING_SYNC: '12' })).toBe(12);
    });

    it('usa el override global', () => {
      expect(resolveConcurrency('banking-sync', { QUEUE_CONCURRENCY: '3' })).toBe(3);
    });

    it('prioriza la configuración específica sobre la global', () => {
      expect(
        resolveConcurrency('banking-sync', {
          QUEUE_CONCURRENCY_BANKING_SYNC: '12',
          QUEUE_CONCURRENCY: '3',
        }),
      ).toBe(12);
    });

    it.each(['0', '51', 'abc'])('cae al valor por defecto con "%s"', (value) => {
      expect(resolveConcurrency('banking-sync', { QUEUE_CONCURRENCY_BANKING_SYNC: value })).toBe(5);
    });

    it('usa 5 cuando no hay configuración', () => {
      expect(resolveConcurrency('banking-sync', {})).toBe(5);
    });
  });

  describe('resolveShutdownTimeoutMs', () => {
    it('acepta un valor dentro del rango', () => {
      expect(resolveShutdownTimeoutMs({ QUEUE_SHUTDOWN_TIMEOUT_MS: '5000' })).toBe(5_000);
    });

    it.each(['999', '999999'])('cae al valor por defecto con "%s"', (value) => {
      expect(resolveShutdownTimeoutMs({ QUEUE_SHUTDOWN_TIMEOUT_MS: value })).toBe(30_000);
    });

    it('usa 30000 ms cuando no hay configuración', () => {
      expect(resolveShutdownTimeoutMs({})).toBe(30_000);
    });
  });

  describe('nombres y opciones por defecto', () => {
    it('construye el nombre de la DLQ', () => {
      expect(dlqName('ocr')).toBe('ocr-dlq');
    });

    it('define 5 intentos con backoff exponencial de 2000 ms', () => {
      expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
      expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 2_000 });
    });

    it('declara exactamente las 4 colas del issue', () => {
      expect(Object.values(QUEUE_NAMES)).toEqual([
        'banking-sync',
        'ocr',
        'reconciliation',
        'notifications',
      ]);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeCounterpartySimilarity,
  computeDateDeltaDays,
  isEligibleCandidate,
  levenshteinDistance,
  matchBatch,
  matchInvoiceNumber,
  normalizeText,
  scoreCandidatePair,
  type MatcherBankTransaction,
  type MatcherDocument,
} from '../src/reconciliation/reconciliation.matcher';
import { ReconciliationMatchStatus } from '@mybusiness/contracts';

describe('ReconciliationMatcher (Unit)', () => {
  describe('normalizeText', () => {
    it('convierte a minúsculas y elimina acentos y diacríticos', () => {
      expect(normalizeText('CAFÉ Y RESTAURANTE EL PEÑÓN')).toBe('cafe y restaurante el penon');
    });

    it('elimina signos de puntuación y símbolos', () => {
      expect(normalizeText('EMPRESA, S.A.S. - BOGOTÁ / COLOMBIA!')).toBe('empresa bogota colombia');
    });

    it('elimina sufijos societarios comunes (S.A.S, S.L., LTDA, INC, CORP, etc.)', () => {
      expect(normalizeText('Inversiones Alpha S.A.S.')).toBe('inversiones alpha');
      expect(normalizeText('Servicios Globales Ltda.')).toBe('servicios globales');
      expect(normalizeText('Cloud Systems Inc.')).toBe('cloud systems');
      expect(normalizeText('Consultora Beta S.L.')).toBe('consultora beta');
    });

    it('colapsa espacios múltiples y recorta extremos', () => {
      expect(normalizeText('   Hola     Mundo   ')).toBe('hola mundo');
    });

    it('maneja valores vacíos, nulos o indefinidos', () => {
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
      expect(normalizeText('')).toBe('');
    });
  });

  describe('levenshteinDistance', () => {
    it('devuelve 0 para cadenas idénticas', () => {
      expect(levenshteinDistance('acme', 'acme')).toBe(0);
    });

    it('calcula la distancia de edición básica', () => {
      expect(levenshteinDistance('gato', 'pato')).toBe(1);
      expect(levenshteinDistance('casa', 'caso')).toBe(1);
      expect(levenshteinDistance('', 'abc')).toBe(3);
    });
  });

  describe('computeCounterpartySimilarity', () => {
    it('devuelve 1.0 para contrapartes idénticas tras normalización', () => {
      const sim = computeCounterpartySimilarity('Amazon Web Services Inc.', 'AMAZON WEB SERVICES');
      expect(sim).toBe(1.0);
    });

    it('devuelve score alto si una contiene a la otra', () => {
      const sim = computeCounterpartySimilarity('Uber BV', 'UBER RIDES');
      expect(sim).toBeGreaterThanOrEqual(0.85);
    });

    it('reconoce variaciones con diacríticos y tipos societarios', () => {
      const sim = computeCounterpartySimilarity(
        'Restaurante El Peñón S.A.S.',
        'Restaurante El Penon',
      );
      expect(sim).toBe(1.0);
    });

    it('devuelve 0 si son totalmente diferentes', () => {
      const sim = computeCounterpartySimilarity('Microsoft Corp', 'Panadería Doña Rosa');
      expect(sim).toBe(0);
    });

    it('devuelve 0 si alguna es nula o vacía', () => {
      expect(computeCounterpartySimilarity(null, 'Acme')).toBe(0);
      expect(computeCounterpartySimilarity('', '')).toBe(0);
    });
  });

  describe('matchInvoiceNumber', () => {
    it('detecta número de factura exacto en el nombre de la transacción', () => {
      expect(matchInvoiceNumber('FAC-2026-001', 'PAGO FAC-2026-001 PROVEEDOR')).toBe(true);
    });

    it('detecta número de factura ignorando guiones o espacios', () => {
      expect(matchInvoiceNumber('FAC-2026-001', 'TRANSFERENCIA FAC2026001 SERVICIOS')).toBe(true);
    });

    it('devuelve false si no coincide o es nulo', () => {
      expect(matchInvoiceNumber(null, 'PAGO 123')).toBe(false);
      expect(matchInvoiceNumber('FAC-999', 'PAGO FAC-111')).toBe(false);
      expect(matchInvoiceNumber('FAC-999', null)).toBe(false);
    });
  });

  describe('computeDateDeltaDays', () => {
    it('calcula correctamente la diferencia en días', () => {
      expect(computeDateDeltaDays('2026-10-10', '2026-10-10')).toBe(0);
      expect(computeDateDeltaDays('2026-10-10', '2026-10-15')).toBe(5);
      expect(computeDateDeltaDays('2026-10-15', '2026-10-10')).toBe(5);
    });

    it('funciona con formatos ISO con timestamp', () => {
      expect(computeDateDeltaDays('2026-10-10T15:30:00Z', '2026-10-12T08:00:00Z')).toBe(2);
    });
  });

  describe('isEligibleCandidate', () => {
    const baseTx: MatcherBankTransaction = {
      id: 'tx-1',
      amountMinor: -150000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-10',
      name: 'PAGO PROVEEDOR',
    };

    const baseDoc: MatcherDocument = {
      id: 'doc-1',
      totalMinor: 150000n,
      currency: 'COP',
      issueDate: '2026-10-11',
      status: 'EXTRACTED',
      confidence: 0.95,
    };

    it('acepta par con monto exacto, misma moneda y fecha en ventana', () => {
      expect(isEligibleCandidate(baseTx, baseDoc, 5)).toBe(true);
    });

    it('rechaza si el monto absoluto difiere', () => {
      const docDiffAmount = { ...baseDoc, totalMinor: 160000n };
      expect(isEligibleCandidate(baseTx, docDiffAmount, 5)).toBe(false);
    });

    it('rechaza si la moneda difiere', () => {
      const docDiffCurrency = { ...baseDoc, currency: 'USD' };
      expect(isEligibleCandidate(baseTx, docDiffCurrency, 5)).toBe(false);
    });

    it('acepta si el documento o la transacción no tienen moneda explícita', () => {
      const docNoCurrency = { ...baseDoc, currency: null };
      expect(isEligibleCandidate(baseTx, docNoCurrency, 5)).toBe(true);
    });

    it('rechaza si la fecha está fuera de la ventana de días', () => {
      const docFarDate = { ...baseDoc, issueDate: '2026-10-20' };
      expect(isEligibleCandidate(baseTx, docFarDate, 5)).toBe(false);
    });
  });

  describe('scoreCandidatePair', () => {
    const tx: MatcherBankTransaction = {
      id: 'tx-1',
      amountMinor: 200000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-10',
      name: 'PAGO FACTURA FAC-999 SUMINISTROS BOGOTA S.A.S.',
    };

    it('calcula 1.0 cuando coinciden monto, fecha (0 delta), contraparte y factura', () => {
      const doc: MatcherDocument = {
        id: 'doc-1',
        totalMinor: 200000n,
        currency: 'COP',
        issueDate: '2026-10-10',
        providerName: 'Suministros Bogota S.A.S.',
        invoiceNumber: 'FAC-999',
        status: 'EXTRACTED',
        confidence: 0.98,
      };

      const result = scoreCandidatePair(tx, doc, 5);
      expect(result.score).toBe(1.0);
      expect(result.rule).toBe('amount+date+counterparty+invoice_number');
      expect(result.evidence.invoiceNumberMatch).toBe(true);
      expect(result.evidence.dateDeltaDays).toBe(0);
      expect(result.evidence.counterpartySimilarity).toBe(1.0);
    });

    it('aplica ponderación decreciente por cercanía de fecha', () => {
      const docDay0: MatcherDocument = {
        id: 'doc-0',
        totalMinor: 200000n,
        currency: 'COP',
        issueDate: '2026-10-10',
        status: 'EXTRACTED',
      };
      const docDay5: MatcherDocument = {
        id: 'doc-5',
        totalMinor: 200000n,
        currency: 'COP',
        issueDate: '2026-10-15',
        status: 'EXTRACTED',
      };

      // Sin contraparte ni factura:
      // Day 0: 0.40 monto + 0.20 fecha = 0.60
      // Day 5 (ventana 5): 0.40 monto + 0.20*(1 - 5/5) = 0.40
      const scoreDay0 = scoreCandidatePair(tx, docDay0, 5).score;
      const scoreDay5 = scoreCandidatePair(tx, docDay5, 5).score;

      expect(scoreDay0).toBe(0.6);
      expect(scoreDay5).toBe(0.4);
    });
  });

  describe('matchBatch (Lógica de Auto-match vs Needs Review)', () => {
    const options = {
      dateWindowDays: 5,
      autoMatchThresholdBps: 8500, // 0.85
      ocrConfidenceThreshold: 0.85,
    };

    it('auto-concilia cuando score >= 0.85, doc EXTRACTED y confianza alta', () => {
      const tx: MatcherBankTransaction = {
        id: 'tx-100',
        amountMinor: 100000n,
        isoCurrencyCode: 'USD',
        date: '2026-10-01',
        name: 'AMAZON WEB SERVICES CLOUD INV-12345',
      };

      const doc: MatcherDocument = {
        id: 'doc-100',
        totalMinor: 100000n,
        currency: 'USD',
        issueDate: '2026-10-01',
        providerName: 'Amazon Web Services Inc.',
        invoiceNumber: 'INV-12345',
        status: 'EXTRACTED',
        confidence: 0.95,
      };

      const results = matchBatch([tx], [doc], options);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(ReconciliationMatchStatus.AUTO_MATCHED);
      expect(results[0].isAutoMatch).toBe(true);
      expect(results[0].score).toBe(1.0);
    });

    it('marca NEEDS_REVIEW si el documento tiene confianza baja (< 0.85)', () => {
      const tx: MatcherBankTransaction = {
        id: 'tx-101',
        amountMinor: 100000n,
        isoCurrencyCode: 'USD',
        date: '2026-10-01',
        name: 'AMAZON WEB SERVICES CLOUD INV-12345',
      };

      const docLowConfidence: MatcherDocument = {
        id: 'doc-101',
        totalMinor: 100000n,
        currency: 'USD',
        issueDate: '2026-10-01',
        providerName: 'Amazon Web Services Inc.',
        invoiceNumber: 'INV-12345',
        status: 'EXTRACTED',
        confidence: 0.7, // Baja confianza
      };

      const results = matchBatch([tx], [docLowConfidence], options);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(ReconciliationMatchStatus.NEEDS_REVIEW);
      expect(results[0].isAutoMatch).toBe(false);
    });

    it('marca NEEDS_REVIEW si el documento está en estado NEEDS_REVIEW', () => {
      const tx: MatcherBankTransaction = {
        id: 'tx-102',
        amountMinor: 100000n,
        isoCurrencyCode: 'USD',
        date: '2026-10-01',
        name: 'AMAZON WEB SERVICES',
      };

      const docNeedsReview: MatcherDocument = {
        id: 'doc-102',
        totalMinor: 100000n,
        currency: 'USD',
        issueDate: '2026-10-01',
        providerName: 'Amazon Web Services',
        status: 'NEEDS_REVIEW',
        confidence: 0.95,
      };

      const results = matchBatch([tx], [docNeedsReview], options);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(ReconciliationMatchStatus.NEEDS_REVIEW);
      expect(results[0].isAutoMatch).toBe(false);
    });

    it('marca NEEDS_REVIEW cuando hay empate ambiguo (< 0.05 de diferencia entre los mejores candidatos)', () => {
      const tx: MatcherBankTransaction = {
        id: 'tx-ambiguous',
        amountMinor: 50000n,
        isoCurrencyCode: 'COP',
        date: '2026-10-01',
        name: 'PAGO SERVICIO COMERCIAL',
      };

      // Dos documentos con mismo importe, misma fecha, pero proveedores distintos y puntuaciones muy cercanas
      const docA: MatcherDocument = {
        id: 'doc-a',
        totalMinor: 50000n,
        currency: 'COP',
        issueDate: '2026-10-01',
        providerName: 'Proveedor Comercial A',
        status: 'EXTRACTED',
        confidence: 0.95,
      };

      const docB: MatcherDocument = {
        id: 'doc-b',
        totalMinor: 50000n,
        currency: 'COP',
        issueDate: '2026-10-01',
        providerName: 'Proveedor Comercial B',
        status: 'EXTRACTED',
        confidence: 0.95,
      };

      const results = matchBatch([tx], [docA, docB], options);
      // El mejor candidato debe ir a NEEDS_REVIEW por empate ambiguo
      const primaryMatch = results.find(
        (r) => r.documentId === docA.id || r.documentId === docB.id,
      );
      expect(primaryMatch?.status).toBe(ReconciliationMatchStatus.NEEDS_REVIEW);
      expect(primaryMatch?.isAutoMatch).toBe(false);
      expect(primaryMatch?.hasAmbiguousTie).toBe(true);
    });

    it('no concilia dos veces el mismo documento en auto-match', () => {
      const tx1: MatcherBankTransaction = {
        id: 'tx-1',
        amountMinor: 100000n,
        isoCurrencyCode: 'USD',
        date: '2026-10-01',
        name: 'ACME CORP',
      };
      const tx2: MatcherBankTransaction = {
        id: 'tx-2',
        amountMinor: 100000n,
        isoCurrencyCode: 'USD',
        date: '2026-10-01',
        name: 'ACME CORP',
      };

      // Sólo hay un documento de ACME
      const singleDoc: MatcherDocument = {
        id: 'doc-acme',
        totalMinor: 100000n,
        currency: 'USD',
        issueDate: '2026-10-01',
        providerName: 'ACME Corp',
        status: 'EXTRACTED',
        confidence: 0.95,
      };

      const results = matchBatch([tx1, tx2], [singleDoc], options);
      const autoMatches = results.filter(
        (r) => r.status === ReconciliationMatchStatus.AUTO_MATCHED,
      );
      // Sólo uno puede ser auto-conciliado con el documento
      expect(autoMatches).toHaveLength(1);
    });
  });
});

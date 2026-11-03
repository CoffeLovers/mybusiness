import { ReconciliationMatchStatus, type ReconciliationEvidence } from '@mybusiness/contracts';

export interface MatcherBankTransaction {
  id: string;
  amountMinor: bigint | string | number;
  isoCurrencyCode?: string | null;
  date: string;
  name: string;
  merchantName?: string | null;
}

export interface MatcherDocument {
  id: string;
  totalMinor: bigint | string | number | null;
  currency?: string | null;
  issueDate?: string | null;
  createdAt?: Date | string | null;
  providerName?: string | null;
  invoiceNumber?: string | null;
  status: string;
  confidence?: number | string | null;
}

export interface MatchCandidate {
  bankTransactionId: string;
  documentId: string;
  score: number;
  rule: string;
  evidence: ReconciliationEvidence;
  isAutoMatch: boolean;
  status: ReconciliationMatchStatus;
  hasAmbiguousTie: boolean;
}

export interface MatcherOptions {
  dateWindowDays: number;
  autoMatchThresholdBps: number;
  ocrConfidenceThreshold?: number;
}

const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.85;

const STOPWORDS = new Set([
  'de',
  'del',
  'el',
  'la',
  'los',
  'las',
  'y',
  'en',
  'the',
  'of',
  'and',
  'por',
  'para',
]);

/**
 * Normaliza una cadena de texto para comparación determinista:
 * - minúsculas
 * - sin acentos / diacríticos
 * - acrónimos normalizados (s.a.s. -> sas, etc.)
 * - sin puntuación
 * - sin sufijos societarios
 * - espacios colapsados
 */
export function normalizeText(value?: string | null): string {
  if (!value) return '';

  let str = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Normalizar acrónimos con puntos antes de remover puntuación (s.a.s. -> sas, s.l. -> sl, etc.)
  str = str.replace(/\b([a-z])\.([a-z])\.([a-z])\.?/g, '$1$2$3');
  str = str.replace(/\b([a-z])\.([a-z])\.?/g, '$1$2');

  // Remover signos de puntuación y símbolos
  str = str.replace(/[^\w\s]/g, ' ');

  // Remover sufijos societarios comunes
  const suffixes =
    /\b(sas|sa|sl|slu|ltda|ltd|inc|llc|corp|corporation|gmbh|bv|cia|sucursal|esp|pty)\b/gi;
  str = str.replace(suffixes, ' ');

  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Distancia de Levenshtein pura en TypeScript, sin dependencias.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row: number[] = [];
  for (let j = 0; j <= b.length; j++) {
    row[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const current = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = current;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

/**
 * Extrae tokens significativos descartando stopwords y palabras de una letra.
 */
function extractMeaningfulTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Similitud difusa determinista entre dos contrapartes (0.0 .. 1.0).
 * Combina coincidencia de subcadena, tokens (Jaccard / inclusión / solapamiento), acrónimos y Levenshtein.
 */
export function computeCounterpartySimilarity(
  nameA?: string | null,
  nameB?: string | null,
): number {
  const normA = normalizeText(nameA);
  const normB = normalizeText(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Si una subcadena de al menos 3 caracteres contiene exactamente a la otra
  if (
    (normA.length >= 3 && normB.includes(normA)) ||
    (normB.length >= 3 && normA.includes(normB))
  ) {
    return 1.0;
  }

  const tokensA = extractMeaningfulTokens(normA);
  const tokensB = extractMeaningfulTokens(normB);

  // Detección de acrónimos (por ejemplo "ETB" <-> "Empresa Telecomunicaciones Bogota")
  if (tokensA.length >= 2 || tokensB.length >= 2) {
    const acronymA = tokensA.map((t) => t[0]).join('');
    const acronymB = tokensB.map((t) => t[0]).join('');
    if (
      tokensB.includes(acronymA) ||
      tokensA.includes(acronymB) ||
      normA === acronymB ||
      normB === acronymA
    ) {
      return 1.0;
    }
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  let hasDistinctiveSharedToken = false;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
      if (token.length >= 4) {
        hasDistinctiveSharedToken = true;
      }
    }
  }

  // Si todos los tokens significativos de una están en la otra
  if (intersection > 0 && (intersection === setA.size || intersection === setB.size)) {
    return 1.0;
  }

  // Coeficiente de solapamiento
  const minSize = Math.min(setA.size, setB.size);
  const overlap = minSize > 0 ? intersection / minSize : 0;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Levenshtein ratio normalizado
  const maxLen = Math.max(normA.length, normB.length);
  const levDist = levenshteinDistance(normA, normB);
  const levRatio = maxLen > 0 ? (maxLen - levDist) / maxLen : 0;

  // Si no hay ningún token compartido y el ratio de Levenshtein es bajo (< 0.45), es 0
  if (intersection === 0 && levRatio < 0.45) {
    return 0;
  }

  // Si comparten al menos el 50% de las palabras del nombre más corto o una marca distintiva (>= 4 letras)
  let overlapScore = jaccard;
  if (overlap >= 0.5 && hasDistinctiveSharedToken) {
    overlapScore = Math.max(0.75, overlap);
  } else if (hasDistinctiveSharedToken) {
    overlapScore = Math.max(0.7, jaccard);
  }

  const bestScore = Math.max(overlapScore, levRatio);
  return Number(Math.min(1.0, Math.max(0, bestScore)).toFixed(3));
}

/**
 * Determina si el número de factura aparece en la descripción/nombre de la transacción.
 */
export function matchInvoiceNumber(
  invoiceNumber?: string | null,
  bankTransactionText?: string | null,
): boolean {
  if (!invoiceNumber || !bankTransactionText) return false;

  const rawInvoice = invoiceNumber.trim().toLowerCase();
  const rawTx = bankTransactionText.trim().toLowerCase();
  if (rawInvoice.length >= 3 && rawTx.includes(rawInvoice)) {
    return true;
  }

  // Comparación alfanumérica sin guiones ni espacios
  const cleanInvoice = rawInvoice.replace(/[^a-z0-9]/g, '');
  const cleanTx = rawTx.replace(/[^a-z0-9]/g, '');
  if (cleanInvoice.length >= 3 && cleanTx.includes(cleanInvoice)) {
    return true;
  }

  return false;
}

/**
 * Calcula la diferencia absoluta de días de calendario entre dos fechas (ISO o YYYY-MM-DD).
 */
export function computeDateDeltaDays(dateA: string, dateB: string): number {
  const parseToUtcMidnight = (str: string): number => {
    const parts = str.slice(0, 10).split('-');
    if (parts.length === 3) {
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      return Date.UTC(year, month, day);
    }
    const d = new Date(str);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const msA = parseToUtcMidnight(dateA);
  const msB = parseToUtcMidnight(dateB);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(Math.round((msA - msB) / msPerDay));
}

export function toBigIntAbsolute(value: bigint | string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  const b = typeof value === 'bigint' ? value : BigInt(String(value));
  return b < 0n ? -b : b;
}

export function getDocumentDateString(doc: MatcherDocument): string | null {
  if (doc.issueDate) return doc.issueDate.slice(0, 10);
  if (doc.createdAt) {
    if (typeof doc.createdAt === 'string') return doc.createdAt.slice(0, 10);
    return doc.createdAt.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Verifica si un par transacción-documento cumple las condiciones mínimas para ser candidato:
 * - mismo importe absoluto;
 * - misma moneda si ambos la tienen;
 * - diferencia de fecha dentro de `dateWindowDays`.
 */
export function isEligibleCandidate(
  bankTx: MatcherBankTransaction,
  doc: MatcherDocument,
  dateWindowDays: number,
): boolean {
  if (doc.totalMinor === null || doc.totalMinor === undefined) {
    return false;
  }

  const txAmount = toBigIntAbsolute(bankTx.amountMinor);
  const docAmount = toBigIntAbsolute(doc.totalMinor);
  if (txAmount !== docAmount || txAmount === 0n) {
    return false;
  }

  const txCurrency = bankTx.isoCurrencyCode?.trim().toUpperCase();
  const docCurrency = doc.currency?.trim().toUpperCase();
  if (txCurrency && docCurrency && txCurrency !== docCurrency) {
    return false;
  }

  const docDate = getDocumentDateString(doc);
  if (!docDate) {
    return false;
  }

  const delta = computeDateDeltaDays(bankTx.date, docDate);
  if (delta > dateWindowDays) {
    return false;
  }

  return true;
}

/**
 * Evalúa el score y la evidencia de un candidato.
 * Score 0..1:
 * - monto exacto: 0.40;
 * - cercanía de fecha: 0.20 * (1 - díasDiferencia / ventana);
 * - similitud de contraparte: 0.30 * similitud;
 * - número de factura exacto: 0.10.
 */
export function scoreCandidatePair(
  bankTx: MatcherBankTransaction,
  doc: MatcherDocument,
  dateWindowDays: number,
): { score: number; rule: string; evidence: ReconciliationEvidence } {
  const docDate = getDocumentDateString(doc)!;
  const deltaDays = computeDateDeltaDays(bankTx.date, docDate);

  // 1. Monto exacto (0.40)
  const amountScore = 0.4;

  // 2. Cercanía de fecha (0.20 * (1 - díasDiferencia / ventana))
  const safeWindow = Math.max(1, dateWindowDays);
  const dateProximityRatio = Math.max(0, 1 - deltaDays / safeWindow);
  const dateScore = 0.2 * dateProximityRatio;

  // 3. Similitud de contraparte (0.30 * similitud)
  const txCounterparty = bankTx.merchantName || bankTx.name;
  const counterpartySimilarity = computeCounterpartySimilarity(txCounterparty, doc.providerName);
  const counterpartyScore = 0.3 * counterpartySimilarity;

  // 4. Coincidencia de número de factura (0.10)
  const invoiceMatch = matchInvoiceNumber(doc.invoiceNumber, bankTx.name);
  const invoiceScore = invoiceMatch ? 0.1 : 0.0;

  const rawScore = amountScore + dateScore + counterpartyScore + invoiceScore;
  const score = Number(Math.min(1.0, Math.max(0, rawScore)).toFixed(3));

  // Regla explicativa
  const hasCounterparty = counterpartySimilarity >= 0.6;
  let rule = 'amount+date';
  if (hasCounterparty && invoiceMatch) {
    rule = 'amount+date+counterparty+invoice_number';
  } else if (hasCounterparty) {
    rule = 'amount+date+counterparty';
  } else if (invoiceMatch) {
    rule = 'amount+date+invoice_number';
  }

  const txAmount = toBigIntAbsolute(bankTx.amountMinor);

  const evidence: ReconciliationEvidence = {
    amountMinor: txAmount.toString(),
    currency: bankTx.isoCurrencyCode || doc.currency || 'USD',
    dateDeltaDays: deltaDays,
    counterpartySimilarity,
    invoiceNumberMatch: invoiceMatch,
    score,
    rule,
    bankTransactionDate: bankTx.date,
    documentIssueDate: docDate,
    bankTransactionName: bankTx.name,
    documentProviderName: doc.providerName ?? null,
    documentInvoiceNumber: doc.invoiceNumber ?? null,
  };

  return { score, rule, evidence };
}

/**
 * Agrupa documentos por clave de importe y moneda para búsqueda rápida en memoria.
 */
export function buildDocumentIndex(documents: MatcherDocument[]): Map<string, MatcherDocument[]> {
  const index = new Map<string, MatcherDocument[]>();

  for (const doc of documents) {
    if (doc.totalMinor === null || doc.totalMinor === undefined) continue;
    const amountStr = toBigIntAbsolute(doc.totalMinor).toString();
    const currency = doc.currency ? doc.currency.trim().toUpperCase() : 'ANY';

    const keys = [
      `${currency}:${amountStr}`,
      currency !== 'ANY' ? `ANY:${amountStr}` : null,
    ].filter((k): k is string => k !== null);

    for (const key of keys) {
      const list = index.get(key) ?? [];
      list.push(doc);
      index.set(key, list);
    }
  }

  return index;
}

/**
 * Ejecuta el matching en lote con resolución de empate ambiguo y asignación 1-a-1 sin duplicados.
 */
export function matchBatch(
  transactions: MatcherBankTransaction[],
  documents: MatcherDocument[],
  options: MatcherOptions,
): MatchCandidate[] {
  const threshold = options.autoMatchThresholdBps / 10000;
  const ocrThreshold = options.ocrConfidenceThreshold ?? DEFAULT_OCR_CONFIDENCE_THRESHOLD;

  // Índice en memoria
  const docIndex = buildDocumentIndex(documents);

  // 1. Encontrar todos los candidatos por transacción
  type ScoredCandidate = {
    bankTransaction: MatcherBankTransaction;
    document: MatcherDocument;
    score: number;
    rule: string;
    evidence: ReconciliationEvidence;
  };

  const perTxCandidates = new Map<string, ScoredCandidate[]>();

  for (const tx of transactions) {
    const amountStr = toBigIntAbsolute(tx.amountMinor).toString();
    const currency = tx.isoCurrencyCode ? tx.isoCurrencyCode.trim().toUpperCase() : 'ANY';

    const candidatesFromKey = docIndex.get(`${currency}:${amountStr}`) ?? [];
    const candidatesFromAny = currency !== 'ANY' ? (docIndex.get(`ANY:${amountStr}`) ?? []) : [];
    const potentialDocs = Array.from(new Set([...candidatesFromKey, ...candidatesFromAny]));

    const scoredList: ScoredCandidate[] = [];

    for (const doc of potentialDocs) {
      if (!isEligibleCandidate(tx, doc, options.dateWindowDays)) {
        continue;
      }
      const { score, rule, evidence } = scoreCandidatePair(tx, doc, options.dateWindowDays);
      scoredList.push({
        bankTransaction: tx,
        document: doc,
        score,
        rule,
        evidence,
      });
    }

    // Ordenar descendente por score
    scoredList.sort((a, b) => b.score - a.score);
    if (scoredList.length > 0) {
      perTxCandidates.set(tx.id, scoredList);
    }
  }

  // 2. Determinar candidatos con verificación de ambigüedad
  const results: MatchCandidate[] = [];
  const autoMatchedTxIds = new Set<string>();
  const autoMatchedDocIds = new Set<string>();

  type TopChoice = {
    tx: MatcherBankTransaction;
    best: ScoredCandidate;
    second?: ScoredCandidate;
    hasAmbiguousTie: boolean;
  };

  const topChoices: TopChoice[] = [];

  for (const [, list] of perTxCandidates.entries()) {
    const best = list[0];
    const second = list.length > 1 ? list[1] : undefined;
    const hasAmbiguousTie = second !== undefined && Math.abs(best.score - second.score) < 0.05;

    topChoices.push({
      tx: best.bankTransaction,
      best,
      second,
      hasAmbiguousTie,
    });
  }

  // Ordenar los mejores candidatos globalmente por score descendente
  topChoices.sort((a, b) => b.best.score - a.best.score);

  for (const choice of topChoices) {
    const { tx, best, second, hasAmbiguousTie } = choice;
    const doc = best.document;

    const docConfidence =
      doc.confidence !== null && doc.confidence !== undefined ? Number(doc.confidence) : null;

    const meetsOcrConfidence = (docConfidence ?? 0) >= ocrThreshold;
    const meetsStatus = doc.status === 'EXTRACTED';
    const meetsScore = best.score >= threshold;
    const notAlreadyMatched = !autoMatchedTxIds.has(tx.id) && !autoMatchedDocIds.has(doc.id);

    const isAutoMatch =
      meetsStatus && meetsOcrConfidence && meetsScore && !hasAmbiguousTie && notAlreadyMatched;

    const status = isAutoMatch
      ? ReconciliationMatchStatus.AUTO_MATCHED
      : ReconciliationMatchStatus.NEEDS_REVIEW;

    if (isAutoMatch) {
      autoMatchedTxIds.add(tx.id);
      autoMatchedDocIds.add(doc.id);
    }

    results.push({
      bankTransactionId: tx.id,
      documentId: doc.id,
      score: best.score,
      rule: best.rule,
      evidence: best.evidence,
      isAutoMatch,
      status,
      hasAmbiguousTie,
    });

    if (hasAmbiguousTie && second) {
      results.push({
        bankTransactionId: tx.id,
        documentId: second.document.id,
        score: second.score,
        rule: second.rule,
        evidence: second.evidence,
        isAutoMatch: false,
        status: ReconciliationMatchStatus.NEEDS_REVIEW,
        hasAmbiguousTie: true,
      });
    }
  }

  return results;
}

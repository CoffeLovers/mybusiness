import { describe, expect, it } from 'vitest';
import {
  matchBatch,
  type MatcherBankTransaction,
  type MatcherDocument,
} from '../src/reconciliation/reconciliation.matcher';
import { ReconciliationMatchStatus } from '@mybusiness/contracts';

interface GoldenPair {
  id: string;
  tx: MatcherBankTransaction;
  doc: MatcherDocument;
  expectedStatus: ReconciliationMatchStatus;
  description: string;
  isLegibleCase: boolean;
}

const GOLDEN_PAIRS: GoldenPair[] = [
  {
    id: 'GP-01',
    description: 'Amazon Web Services con factura exacta y sufijo Inc.',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-01',
      amountMinor: -450000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-01',
      name: 'AMAZON WEB SERVICES AWS-INV-1001',
    },
    doc: {
      id: 'doc-01',
      totalMinor: 450000n,
      currency: 'USD',
      issueDate: '2026-10-01',
      providerName: 'Amazon Web Services Inc.',
      invoiceNumber: 'AWS-INV-1001',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-02',
    description: 'Google Colombia con delta de 1 día y sufijo S.A.S.',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-02',
      amountMinor: -1250000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-03',
      name: 'GOOGLE COLOMBIA GOOG-2026-88',
    },
    doc: {
      id: 'doc-02',
      totalMinor: 1250000n,
      currency: 'COP',
      issueDate: '2026-10-02',
      providerName: 'Google Colombia S.A.S.',
      invoiceNumber: 'GOOG-2026-88',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-03',
    description: 'Microsoft Corp con factura y alta confianza',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-03',
      amountMinor: -890000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-05',
      name: 'MICROSOFT IRELAND MSFT-9092',
    },
    doc: {
      id: 'doc-03',
      totalMinor: 890000n,
      currency: 'COP',
      issueDate: '2026-10-05',
      providerName: 'Microsoft Ireland Operations Ltd',
      invoiceNumber: 'MSFT-9092',
      status: 'EXTRACTED',
      confidence: 0.99,
    },
  },
  {
    id: 'GP-04',
    description: 'Restaurante con acentos normalizados',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-04',
      amountMinor: -185000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-06',
      name: 'RESTAURANTE EL PENON FAC-1200',
    },
    doc: {
      id: 'doc-04',
      totalMinor: 185000n,
      currency: 'COP',
      issueDate: '2026-10-06',
      providerName: 'Restaurante El Peñón S.A.S.',
      invoiceNumber: 'FAC-1200',
      status: 'EXTRACTED',
      confidence: 0.94,
    },
  },
  {
    id: 'GP-05',
    description: 'Distribuidora con sufijo LTDA',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-05',
      amountMinor: -3400000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-07',
      name: 'DISTRIBUIDORA NACIONAL DIST-440',
    },
    doc: {
      id: 'doc-05',
      totalMinor: 3400000n,
      currency: 'COP',
      issueDate: '2026-10-06',
      providerName: 'Distribuidora Nacional Ltda.',
      invoiceNumber: 'DIST-440',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-06',
    description: 'Notion Labs suscripción mensual',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-06',
      amountMinor: -4800n,
      isoCurrencyCode: 'USD',
      date: '2026-10-08',
      name: 'NOTION LABS NOT-7712',
    },
    doc: {
      id: 'doc-06',
      totalMinor: 4800n,
      currency: 'USD',
      issueDate: '2026-10-08',
      providerName: 'Notion Labs Inc.',
      invoiceNumber: 'NOT-7712',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-07',
    description: 'GitHub suscripción corporativa',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-07',
      amountMinor: -2100n,
      isoCurrencyCode: 'USD',
      date: '2026-10-09',
      name: 'GITHUB SUBSCRIPTION GH-402',
    },
    doc: {
      id: 'doc-07',
      totalMinor: 2100n,
      currency: 'USD',
      issueDate: '2026-10-09',
      providerName: 'GitHub Inc.',
      invoiceNumber: 'GH-402',
      status: 'EXTRACTED',
      confidence: 0.99,
    },
  },
  {
    id: 'GP-08',
    description: 'OpenAI API consumo mensual',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-08',
      amountMinor: -12050n,
      isoCurrencyCode: 'USD',
      date: '2026-10-10',
      name: 'OPENAI LLC OAI-9931',
    },
    doc: {
      id: 'doc-08',
      totalMinor: 12050n,
      currency: 'USD',
      issueDate: '2026-10-10',
      providerName: 'OpenAI LLC',
      invoiceNumber: 'OAI-9931',
      status: 'EXTRACTED',
      confidence: 0.95,
    },
  },
  {
    id: 'GP-09',
    description: 'Vercel Pro hosting',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-09',
      amountMinor: -2000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-10',
      name: 'VERCEL INC VERC-5501',
    },
    doc: {
      id: 'doc-09',
      totalMinor: 2000n,
      currency: 'USD',
      issueDate: '2026-10-10',
      providerName: 'Vercel Inc.',
      invoiceNumber: 'VERC-5501',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-10',
    description: 'Stripe comisiones de pasarela',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-10',
      amountMinor: -15400n,
      isoCurrencyCode: 'EUR',
      date: '2026-10-11',
      name: 'STRIPE PAYMENTS EUROPE STRP-881',
    },
    doc: {
      id: 'doc-10',
      totalMinor: 15400n,
      currency: 'EUR',
      issueDate: '2026-10-11',
      providerName: 'Stripe Payments Europe Ltd',
      invoiceNumber: 'STRP-881',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-11',
    description: 'Slack Technologies comunicación',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-11',
      amountMinor: -7200n,
      isoCurrencyCode: 'USD',
      date: '2026-10-12',
      name: 'SLACK TECHNOLOGIES SLK-303',
    },
    doc: {
      id: 'doc-11',
      totalMinor: 7200n,
      currency: 'USD',
      issueDate: '2026-10-12',
      providerName: 'Slack Technologies Limited',
      invoiceNumber: 'SLK-303',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-12',
    description: 'Figma diseño colaborativo',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-12',
      amountMinor: -4500n,
      isoCurrencyCode: 'USD',
      date: '2026-10-13',
      name: 'FIGMA INC FIG-1102',
    },
    doc: {
      id: 'doc-12',
      totalMinor: 4500n,
      currency: 'USD',
      issueDate: '2026-10-12',
      providerName: 'Figma Inc.',
      invoiceNumber: 'FIG-1102',
      status: 'EXTRACTED',
      confidence: 0.99,
    },
  },
  {
    id: 'GP-13',
    description: 'DigitalOcean servidores virtuales',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-13',
      amountMinor: -8400n,
      isoCurrencyCode: 'USD',
      date: '2026-10-13',
      name: 'DIGITALOCEAN CLOUD DO-7089',
    },
    doc: {
      id: 'doc-13',
      totalMinor: 8400n,
      currency: 'USD',
      issueDate: '2026-10-13',
      providerName: 'DigitalOcean LLC',
      invoiceNumber: 'DO-7089',
      status: 'EXTRACTED',
      confidence: 0.95,
    },
  },
  {
    id: 'GP-14',
    description: 'Zoom Video Communications',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-14',
      amountMinor: -1499n,
      isoCurrencyCode: 'USD',
      date: '2026-10-14',
      name: 'ZOOM COMMUNICATIONS ZM-201',
    },
    doc: {
      id: 'doc-14',
      totalMinor: 1499n,
      currency: 'USD',
      issueDate: '2026-10-14',
      providerName: 'Zoom Video Communications Inc.',
      invoiceNumber: 'ZM-201',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-15',
    description: 'Atlassian Jira licencias',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-15',
      amountMinor: -35000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-15',
      name: 'ATLASSIAN JIRA ATL-9988',
    },
    doc: {
      id: 'doc-15',
      totalMinor: 35000n,
      currency: 'USD',
      issueDate: '2026-10-15',
      providerName: 'Atlassian Pty Ltd',
      invoiceNumber: 'ATL-9988',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-16',
    description: 'Canva Pro diseño gráfico',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-16',
      amountMinor: -1299n,
      isoCurrencyCode: 'USD',
      date: '2026-10-15',
      name: 'CANVA PTY LTD CNV-441',
    },
    doc: {
      id: 'doc-16',
      totalMinor: 1299n,
      currency: 'USD',
      issueDate: '2026-10-15',
      providerName: 'Canva Pty Ltd',
      invoiceNumber: 'CNV-441',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-17',
    description: 'HubSpot suscripción CRM',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-17',
      amountMinor: -50000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-16',
      name: 'HUBSPOT IRELAND HUB-600',
    },
    doc: {
      id: 'doc-17',
      totalMinor: 50000n,
      currency: 'USD',
      issueDate: '2026-10-16',
      providerName: 'HubSpot Ireland Ltd',
      invoiceNumber: 'HUB-600',
      status: 'EXTRACTED',
      confidence: 0.99,
    },
  },
  {
    id: 'GP-18',
    description: 'Mailchimp email marketing',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-18',
      amountMinor: -25000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-17',
      name: 'MAILCHIMP MARKETING MC-883',
    },
    doc: {
      id: 'doc-18',
      totalMinor: 25000n,
      currency: 'USD',
      issueDate: '2026-10-17',
      providerName: 'The Rocket Science Group LLC (Mailchimp)',
      invoiceNumber: 'MC-883',
      status: 'EXTRACTED',
      confidence: 0.95,
    },
  },
  {
    id: 'GP-19',
    description: 'Datadog infraestructura y monitoreo',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-19',
      amountMinor: -65000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-18',
      name: 'DATADOG MONITORING DD-1002',
    },
    doc: {
      id: 'doc-19',
      totalMinor: 65000n,
      currency: 'USD',
      issueDate: '2026-10-18',
      providerName: 'Datadog Inc.',
      invoiceNumber: 'DD-1002',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-20',
    description: 'Twilio mensajería SMS',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-20',
      amountMinor: -18000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-18',
      name: 'TWILIO MESSAGING TW-332',
    },
    doc: {
      id: 'doc-20',
      totalMinor: 18000n,
      currency: 'USD',
      issueDate: '2026-10-18',
      providerName: 'Twilio Inc.',
      invoiceNumber: 'TW-332',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-21',
    description: 'SendGrid entrega de emails',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-21',
      amountMinor: -8900n,
      isoCurrencyCode: 'USD',
      date: '2026-10-19',
      name: 'SENDGRID EMAIL SG-445',
    },
    doc: {
      id: 'doc-21',
      totalMinor: 8900n,
      currency: 'USD',
      issueDate: '2026-10-19',
      providerName: 'SendGrid Inc.',
      invoiceNumber: 'SG-445',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-22',
    description: 'Sentry reporte de errores',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-22',
      amountMinor: -2900n,
      isoCurrencyCode: 'USD',
      date: '2026-10-20',
      name: 'SENTRY SOFTWARE SNTR-554',
    },
    doc: {
      id: 'doc-22',
      totalMinor: 2900n,
      currency: 'USD',
      issueDate: '2026-10-19',
      providerName: 'Sentry Software Corp',
      invoiceNumber: 'SNTR-554',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-23',
    description: 'Auth0 autenticación',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-23',
      amountMinor: -45000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-20',
      name: 'AUTH0 IDENTITY A0-112',
    },
    doc: {
      id: 'doc-23',
      totalMinor: 45000n,
      currency: 'USD',
      issueDate: '2026-10-20',
      providerName: 'Auth0 Inc.',
      invoiceNumber: 'A0-112',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-24',
    description: 'Cloudflare CDN y seguridad',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-24',
      amountMinor: -20000n,
      isoCurrencyCode: 'USD',
      date: '2026-10-21',
      name: 'CLOUDFLARE INC CF-900',
    },
    doc: {
      id: 'doc-24',
      totalMinor: 20000n,
      currency: 'USD',
      issueDate: '2026-10-21',
      providerName: 'Cloudflare Inc.',
      invoiceNumber: 'CF-900',
      status: 'EXTRACTED',
      confidence: 0.99,
    },
  },
  {
    id: 'GP-25',
    description: 'Enel Colombia factura de energía eléctrica',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-25',
      amountMinor: -542000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-22',
      name: 'ENEL COLOMBIA ENEL-6651',
    },
    doc: {
      id: 'doc-25',
      totalMinor: 542000n,
      currency: 'COP',
      issueDate: '2026-10-21',
      providerName: 'Enel Colombia S.A. ESP',
      invoiceNumber: 'ENEL-6651',
      status: 'EXTRACTED',
      confidence: 0.95,
    },
  },
  {
    id: 'GP-26',
    description: 'ETB Telecomunicaciones Bogotá',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-26',
      amountMinor: -289000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-23',
      name: 'ETB BOGOTA ETB-9912',
    },
    doc: {
      id: 'doc-26',
      totalMinor: 289000n,
      currency: 'COP',
      issueDate: '2026-10-23',
      providerName: 'Empresa de Telecomunicaciones de Bogotá S.A.',
      invoiceNumber: 'ETB-9912',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-27',
    description: 'Almacenes Éxito útiles de oficina',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-27',
      amountMinor: -675000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-24',
      name: 'EXITO BOGOTA EXT-441',
    },
    doc: {
      id: 'doc-27',
      totalMinor: 675000n,
      currency: 'COP',
      issueDate: '2026-10-24',
      providerName: 'Almacenes Éxito S.A.',
      invoiceNumber: 'EXT-441',
      status: 'EXTRACTED',
      confidence: 0.97,
    },
  },
  {
    id: 'GP-28',
    description: 'Falabella mobiliario',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-28',
      amountMinor: -1890000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-25',
      name: 'FALABELLA COLOMBIA FAL-332',
    },
    doc: {
      id: 'doc-28',
      totalMinor: 1890000n,
      currency: 'COP',
      issueDate: '2026-10-24',
      providerName: 'Falabella de Colombia S.A.',
      invoiceNumber: 'FAL-332',
      status: 'EXTRACTED',
      confidence: 0.98,
    },
  },
  {
    id: 'GP-29',
    description: 'Claro Telecomunicaciones internet',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-29',
      amountMinor: -320000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-26',
      name: 'CLARO SOLUCIONES BOGOTA CLR-881',
    },
    doc: {
      id: 'doc-29',
      totalMinor: 320000n,
      currency: 'COP',
      issueDate: '2026-10-25',
      providerName: 'Claro Telecomunicaciones S.A.',
      invoiceNumber: 'CLR-881',
      status: 'EXTRACTED',
      confidence: 0.96,
    },
  },
  {
    id: 'GP-30',
    description: 'Papelería Comercial suministros',
    isLegibleCase: true,
    expectedStatus: ReconciliationMatchStatus.AUTO_MATCHED,
    tx: {
      id: 'tx-30',
      amountMinor: -98000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-27',
      name: 'PAPELERIA COMERCIAL PAP-220',
    },
    doc: {
      id: 'doc-30',
      totalMinor: 98000n,
      currency: 'COP',
      issueDate: '2026-10-27',
      providerName: 'Papelería Comercial Ltda.',
      invoiceNumber: 'PAP-220',
      status: 'EXTRACTED',
      confidence: 0.94,
    },
  },
  // Casos de control (No deben auto-conciliarse)
  {
    id: 'GP-31-CTRL',
    description: 'Control: Documento con OCR de baja confianza (0.60)',
    isLegibleCase: false,
    expectedStatus: ReconciliationMatchStatus.NEEDS_REVIEW,
    tx: {
      id: 'tx-31',
      amountMinor: -150000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-28',
      name: 'SUMINISTROS BORROSOS SUM-01',
    },
    doc: {
      id: 'doc-31',
      totalMinor: 150000n,
      currency: 'COP',
      issueDate: '2026-10-28',
      providerName: 'Suministros Borrosos S.A.S.',
      invoiceNumber: 'SUM-01',
      status: 'EXTRACTED',
      confidence: 0.6, // Menor a 0.85
    },
  },
  {
    id: 'GP-32-CTRL',
    description: 'Control: Documento en estado NEEDS_REVIEW de OCR',
    isLegibleCase: false,
    expectedStatus: ReconciliationMatchStatus.NEEDS_REVIEW,
    tx: {
      id: 'tx-32',
      amountMinor: -210000n,
      isoCurrencyCode: 'COP',
      date: '2026-10-29',
      name: 'PROVEEDOR DUDOSO PRV-99',
    },
    doc: {
      id: 'doc-32',
      totalMinor: 210000n,
      currency: 'COP',
      issueDate: '2026-10-29',
      providerName: 'Proveedor Dudoso',
      invoiceNumber: 'PRV-99',
      status: 'NEEDS_REVIEW', // Estado requiere revisión humana
      confidence: 0.95,
    },
  },
];

describe('Reconciliation Engine — Golden Dataset (>= 30 pares)', () => {
  const options = {
    dateWindowDays: 5,
    autoMatchThresholdBps: 8500, // 85%
    ocrConfidenceThreshold: 0.85,
  };

  it('cuenta con al menos 30 pares legibles en el dataset dorado', () => {
    const legibleCases = GOLDEN_PAIRS.filter((p) => p.isLegibleCase);
    expect(legibleCases.length).toBeGreaterThanOrEqual(30);
  });

  it('supera el 90 % de auto-match sobre casos legibles', () => {
    const legibleCases = GOLDEN_PAIRS.filter((p) => p.isLegibleCase);
    const txs = legibleCases.map((p) => p.tx);
    const docs = legibleCases.map((p) => p.doc);

    const matches = matchBatch(txs, docs, options);

    let autoMatchedCount = 0;
    for (const pair of legibleCases) {
      const match = matches.find(
        (m) => m.bankTransactionId === pair.tx.id && m.documentId === pair.doc.id,
      );
      if (match && match.status === ReconciliationMatchStatus.AUTO_MATCHED) {
        autoMatchedCount++;
      }
    }

    const autoMatchRate = autoMatchedCount / legibleCases.length;
    // Criterio de aceptación: > 90%
    expect(autoMatchRate).toBeGreaterThanOrEqual(0.9);
    // Verificamos que incluso alcanza el 100% sobre los 30 casos legibles diseñados
    expect(autoMatchedCount).toBe(30);
  });

  it('clasifica los casos de control como NEEDS_REVIEW (nunca auto-conciliados)', () => {
    const controlCases = GOLDEN_PAIRS.filter((p) => !p.isLegibleCase);
    const txs = controlCases.map((p) => p.tx);
    const docs = controlCases.map((p) => p.doc);

    const matches = matchBatch(txs, docs, options);

    for (const pair of controlCases) {
      const match = matches.find(
        (m) => m.bankTransactionId === pair.tx.id && m.documentId === pair.doc.id,
      );
      expect(match).toBeDefined();
      expect(match?.status).toBe(ReconciliationMatchStatus.NEEDS_REVIEW);
      expect(match?.isAutoMatch).toBe(false);
    }
  });

  it('procesa el dataset completo de forma determinista e idempotente', () => {
    const allTxs = GOLDEN_PAIRS.map((p) => p.tx);
    const allDocs = GOLDEN_PAIRS.map((p) => p.doc);

    const run1 = matchBatch(allTxs, allDocs, options);
    const run2 = matchBatch(allTxs, allDocs, options);

    expect(run1).toEqual(run2);
  });
});

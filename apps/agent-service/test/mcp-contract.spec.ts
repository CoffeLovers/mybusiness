import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpToolsListResult } from '@mybusiness/contracts';
import { MCP_SCHEMA_VERSION, MCP_TOOLS } from '../src/mcp/tool-schemas';

/**
 * Contract test del canal `tools/list` del servidor MCP (issue #82 / SF3-12).
 *
 * El esquema expuesto a los clientes del MCP está versionado y congelado en
 * un snapshot JSON (`test/fixtures/mcp-tools-list.v<version>.json`). Cualquier
 * cambio de las herramientas (renombres, propiedades nuevas de input, cambio
 * de `required`, etc.) sin actualizar el snapshot rompe este test en CI y
 * obliga a actualizar snapshot + cliente consumidor antes de mergear.
 */
const FIXTURES_DIR = join(__dirname, 'fixtures');

function snapshotFilename(version: string): string {
  return join(FIXTURES_DIR, `mcp-tools-list.v${version}.json`);
}

function readSnapshot(version: string): McpToolsListResult {
  try {
    return JSON.parse(readFileSync(snapshotFilename(version), 'utf8')) as McpToolsListResult;
  } catch {
    throw new Error(
      [
        `No existe el snapshot versionado del contrato MCP para la versión "${version}".`,
        `Se esperaba el archivo: ${snapshotFilename(version)}`,
        'Genera el snapshot a partir del resultado real de `tools/list` (MCP_TOOLS), revísalo',
        'con el cliente consumidor del MCP y crea el archivo versionado antes de mergear.',
      ].join('\n'),
    );
  }
}

function contractDriftMessage(): string {
  return [
    'CONTRATO MCP DIVERGENTE: el resultado real de `tools/list` no coincide con el',
    'snapshot versionado en test/fixtures/.',
    '',
    'Si el cambio del esquema es intencional:',
    '  1. Incrementa MCP_SCHEMA_VERSION y las versiones por herramienta en tool-schemas.ts.',
    '  2. Crea un snapshot NUEVO (test/fixtures/mcp-tools-list.v<NUEVA_VERSION>.json)',
    '     con el resultado real; no sobrescribas la versión anterior.',
    '  3. ACTUALIZA EL CLIENTE consumidor del canal MCP y coordina el despliegue.',
    '',
    'Si el cambio NO es intencional, revierte la mutación en tool-schemas.ts.',
  ].join('\n');
}

describe('Contrato MCP: canal tools/list versionado (issue #82)', () => {
  it('el snapshot versionado declara la misma schemaVersion que el servidor', () => {
    const snapshot = readSnapshot(MCP_SCHEMA_VERSION);
    expect(snapshot.schemaVersion, contractDriftMessage()).toBe(MCP_SCHEMA_VERSION);
  });

  it('el catálogo de herramientas coincide exactamente con el snapshot versionado', () => {
    const actual = JSON.parse(
      JSON.stringify({ schemaVersion: MCP_SCHEMA_VERSION, tools: MCP_TOOLS }),
    ) as McpToolsListResult;
    const snapshot = readSnapshot(MCP_SCHEMA_VERSION);

    expect(actual, contractDriftMessage()).toEqual(snapshot);
  });

  it('cada herramienta publica versión semver, descripción y esquema JSON rígido', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name, contractDriftMessage()).toMatch(/^[a-z][a-z_]{2,}$/);
      expect(tool.version, `versión semver inválida en ${tool.name}`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tool.description.length, contractDriftMessage()).toBeGreaterThan(10);

      const schema = tool.inputSchema as {
        type?: unknown;
        additionalProperties?: unknown;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, contractDriftMessage()).toBe('object');
      expect(schema.additionalProperties, contractDriftMessage()).toBe(false);
      expect(Object.keys(schema.properties ?? {}), contractDriftMessage()).not.toHaveLength(0);

      const required = schema.required ?? [];
      const properties = Object.keys(schema.properties ?? {});
      for (const field of required) {
        expect(
          properties,
          `required[${field}] de ${tool.name} no es una propiedad declarada`,
        ).toContain(field);
      }
    }
  });

  it('create_payment_link exige importe string entero positivo, moneda ISO y factura', () => {
    const paymentTool = MCP_TOOLS.find((tool) => tool.name === 'create_payment_link');
    expect(paymentTool, contractDriftMessage()).toBeDefined();
    if (!paymentTool) {
      return;
    }

    const schema = paymentTool.inputSchema as {
      properties?: Record<string, unknown>;
      required?: unknown;
    };
    expect(schema.required, contractDriftMessage()).toEqual([
      'amountMinor',
      'currency',
      'invoiceId',
    ]);

    const amountMinor = schema.properties?.amountMinor;
    expect(amountMinor, contractDriftMessage()).toBeDefined();
    if (typeof amountMinor !== 'object' || amountMinor === null) {
      throw new Error(contractDriftMessage());
    }
    const amountSchema = amountMinor as { type?: unknown; pattern?: unknown };
    expect(amountSchema.type, contractDriftMessage()).toBe('string');
    expect(amountSchema.pattern, contractDriftMessage()).toBe('^[1-9][0-9]*$');
  });

  it('el snapshot no contiene credenciales ni identificadores de infraestructura', () => {
    const snapshot = readSnapshot(MCP_SCHEMA_VERSION);
    const serialized = JSON.stringify(snapshot);
    const forbidden = ['Bearer ', 'sk-', 'PAYPAL-', 'checkoutnow'];
    for (const term of forbidden) {
      expect(serialized, `El snapshot de contrato no debe contener "${term}"`).not.toContain(term);
    }
    // Sin identificadores (UUID suelto) ni claves de API en el contrato público
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRepository } from '../src/agent.repository';
import type { AgentDatabaseService } from '../src/database/database.service';
import type { AgentMemory, NewAgentMemory } from '../src/database/schema';
import type { ContextType } from '@mybusiness/contracts';

/**
 * Doble de prueba encadenable de Drizzle ORM.
 * Simula `select().from().where().orderBy().limit()`,
 * `insert().values().returning()` y `delete().where().returning()`
 * sin abrir conexión a PostgreSQL.
 */
interface SelectCall {
  projection?: unknown;
  from?: unknown;
  where?: unknown;
  orderBy?: unknown;
  limit?: number;
}

interface InsertCall {
  values?: unknown;
}

interface DeleteCall {
  where?: unknown;
}

interface DrizzleMock {
  db: {
    select: (projection?: unknown) => unknown;
    insert: (table?: unknown) => unknown;
    delete: (table?: unknown) => unknown;
  };
  selects: SelectCall[];
  selectResults: unknown[][];
  insertCalls: InsertCall[];
  insertResults: unknown[][];
  deleteCalls: DeleteCall[];
  deleteResults: unknown[][];
}

const asRows = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function createDrizzleMock(): DrizzleMock {
  let selectCursor = 0;
  let insertCursor = 0;
  let deleteCursor = 0;

  const mock: DrizzleMock = {
    db: {
      select: (projection?: unknown) => {
        const call: SelectCall = { projection };
        mock.selects.push(call);
        const rows = asRows(mock.selectResults[selectCursor++]);

        const builder = {
          from: vi.fn((table: unknown) => {
            call.from = table;
            return builder;
          }),
          where: vi.fn((condition: unknown) => {
            call.where = condition;
            return builder;
          }),
          orderBy: vi.fn((clause: unknown) => {
            call.orderBy = clause;
            return builder;
          }),
          limit: vi.fn((value: number) => {
            call.limit = value;
            return Promise.resolve(rows);
          }),
        };

        return builder;
      },
      insert: (table: unknown) => {
        const call: InsertCall = {};
        mock.insertCalls.push(call);
        const rows = asRows(mock.insertResults[insertCursor++]);
        const builder = {
          values: vi.fn((values: unknown) => {
            call.values = values;
            return builder;
          }),
          returning: vi.fn(() => {
            expect(table).toBeDefined();
            return Promise.resolve(rows);
          }),
        };
        return builder;
      },
      delete: (table: unknown) => {
        const call: DeleteCall = {};
        mock.deleteCalls.push(call);
        const rows = asRows(mock.deleteResults[deleteCursor++]);
        const builder = {
          where: vi.fn((condition: unknown) => {
            call.where = condition;
            return builder;
          }),
          returning: vi.fn(() => {
            expect(table).toBeDefined();
            return Promise.resolve(rows);
          }),
        };
        return builder;
      },
    },
    selects: [],
    selectResults: [],
    insertCalls: [],
    insertResults: [],
    deleteCalls: [],
    deleteResults: [],
  };

  return mock;
}

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = 'aaaa1111-aaaa-1111-aaaa-111111111111';

const memoryRow: AgentMemory = {
  id: 'mem-1',
  tenantId,
  userId,
  content: 'Regla financiera de prueba',
  embedding: new Array<number>(1536).fill(0),
  contextType: 'FINANCIAL_RULE',
  metadata: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const newMemory: NewAgentMemory = {
  tenantId,
  userId,
  content: 'Regla financiera de prueba',
  embedding: new Array<number>(1536).fill(0),
  contextType: 'FINANCIAL_RULE',
  metadata: {},
};

describe('AgentRepository — Drizzle (mock encadenable)', () => {
  let drizzle: DrizzleMock;
  let repository: AgentRepository;

  beforeEach(() => {
    drizzle = createDrizzleMock();
    repository = new AgentRepository({
      db: drizzle.db,
    } as unknown as AgentDatabaseService);
  });

  it('insert devuelve la fila insertada y pasa los valores', async () => {
    drizzle.insertResults.push([memoryRow]);

    const result = await repository.insert(newMemory);

    expect(result).toBe(memoryRow);
    expect(drizzle.insertCalls).toHaveLength(1);
    expect(drizzle.insertCalls[0].values).toBe(newMemory);
  });

  it('searchSimilar sin userId devuelve distancias numéricas y aplica topK por defecto', async () => {
    drizzle.selectResults.push([{ ...memoryRow, distance: '0.25', similarityScore: '0.75' }]);

    const results = await repository.searchSimilar({
      tenantId,
      embedding: new Array<number>(1536).fill(0.5),
    });

    expect(results).toHaveLength(1);
    expect(typeof results[0].distance).toBe('number');
    expect(typeof results[0].similarityScore).toBe('number');
    expect(results[0].distance).toBe(0.25);
    expect(results[0].similarityScore).toBe(0.75);
    expect(drizzle.selects[0].limit).toBe(5);
  });

  it('no proyecta la columna embedding en el select', async () => {
    drizzle.selectResults.push([]);

    await repository.searchSimilar({
      tenantId,
      embedding: new Array<number>(1536).fill(0.1),
    });

    const projection = drizzle.selects[0].projection;
    expect(projection).toBeTypeOf('object');
    expect(Object.keys(projection as Record<string, unknown>)).not.toContain('embedding');
  });

  it('searchSimilar con contextType y threshold construye la consulta y devuelve resultados', async () => {
    const contextType: ContextType = 'FINANCIAL_RULE';
    drizzle.selectResults.push([
      { ...memoryRow, distance: 0.1, similarityScore: 0.9 },
      { ...memoryRow, id: 'mem-2', distance: 0.2, similarityScore: 0.8 },
    ]);

    const results = await repository.searchSimilar({
      tenantId,
      embedding: new Array<number>(1536).fill(0.3),
      contextType,
      threshold: 0.8,
      topK: 2,
    });

    expect(results).toHaveLength(2);
    expect(drizzle.selects[0].where).toBeDefined();
    expect(drizzle.selects[0].orderBy).toBeDefined();
    expect(drizzle.selects[0].limit).toBe(2);
  });

  it('searchSimilar devuelve [] cuando no hay coincidencias', async () => {
    drizzle.selectResults.push([]);

    const results = await repository.searchSimilar({
      tenantId,
      embedding: new Array<number>(1536).fill(0),
    });

    expect(results).toEqual([]);
  });

  it('delete devuelve true cuando elimina una fila', async () => {
    drizzle.deleteResults.push([{ id: memoryRow.id }]);

    const deleted = await repository.delete(memoryRow.id, tenantId);

    expect(deleted).toBe(true);
    expect(drizzle.deleteCalls[0].where).toBeDefined();
  });

  it('delete devuelve false cuando no elimina filas', async () => {
    drizzle.deleteResults.push([]);

    const deleted = await repository.delete('mem-inexistente', tenantId);

    expect(deleted).toBe(false);
  });

  it('findById devuelve la fila encontrada', async () => {
    drizzle.selectResults.push([memoryRow]);

    const found = await repository.findById(memoryRow.id, tenantId);

    expect(found).toBe(memoryRow);
    expect(drizzle.selects[0].projection).toBeUndefined();
    expect(drizzle.selects[0].limit).toBe(1);
  });

  it('findById devuelve null cuando no existe', async () => {
    drizzle.selectResults.push([]);

    const found = await repository.findById('mem-inexistente', tenantId);

    expect(found).toBeNull();
  });
});

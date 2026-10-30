import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { AgentDatabaseService } from '../src/database/database.service';
import { agentMemories } from '../src/database/schema';
import { AgentRepository } from '../src/agent.repository';

const databaseUrl = process.env.AGENT_DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

const tenantA = '33333333-3333-3333-3333-333333333333';
const tenantB = '44444444-4444-4444-4444-444444444444';

function unitVector(index: number): number[] {
  const vector = new Array<number>(1536).fill(0);
  vector[index] = 1;
  return vector;
}

const e0 = unitVector(0);
const e1 = unitVector(1);

describeIf('AgentRepository — e2e con PostgreSQL + pgvector (#14)', () => {
  let database: AgentDatabaseService;
  let repository: AgentRepository;
  let idA = '';
  let idB = '';

  beforeAll(async () => {
    database = new AgentDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    repository = new AgentRepository(database);

    await database.db
      .delete(agentMemories)
      .where(inArray(agentMemories.tenantId, [tenantA, tenantB]));

    const rowA = await repository.insert({
      tenantId: tenantA,
      userId: null,
      content: 'smoke A',
      embedding: e0,
      contextType: 'FINANCIAL_RULE',
      metadata: {},
    });

    const rowB = await repository.insert({
      tenantId: tenantB,
      userId: null,
      content: 'smoke B',
      embedding: e1,
      contextType: 'FINANCIAL_RULE',
      metadata: {},
    });

    idA = rowA.id;
    idB = rowB.id;
  });

  afterAll(async () => {
    if (!database) {
      return;
    }
    await database.db
      .delete(agentMemories)
      .where(inArray(agentMemories.tenantId, [tenantA, tenantB]));
    await database.onModuleDestroy();
  });

  it('busca en el tenant A con e0 y recupera únicamente smoke A', async () => {
    const results = await repository.searchSimilar({
      tenantId: tenantA,
      embedding: e0,
      topK: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('smoke A');
    expect(results[0].similarityScore).toBeCloseTo(1, 3);
  });

  it('busca en el tenant B con e1 y recupera únicamente smoke B', async () => {
    const results = await repository.searchSimilar({
      tenantId: tenantB,
      embedding: e1,
      topK: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('smoke B');
  });

  it('no devuelve resultados en A para e1 con threshold 0.99', async () => {
    const results = await repository.searchSimilar({
      tenantId: tenantA,
      embedding: e1,
      topK: 5,
      threshold: 0.99,
    });

    expect(results).toHaveLength(0);
  });

  it('aísla operaciones por tenant en delete y findById', async () => {
    await expect(repository.delete(idB, tenantA)).resolves.toBe(false);
    await expect(repository.findById(idA, tenantB)).resolves.toBeNull();
  });
});

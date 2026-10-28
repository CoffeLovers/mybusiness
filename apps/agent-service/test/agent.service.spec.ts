import { describe, it, expect } from 'vitest';
import { ContextType, UserRole, type RequestContext } from '@mybusiness/contracts';
import { AgentService } from '../src/agent.service';

const tenantA: RequestContext = {
  tenantId: 'tenant-A',
  userId: 'user-A',
  role: UserRole.ACCOUNTANT,
};

const tenantB: RequestContext = {
  tenantId: 'tenant-B',
  userId: 'user-B',
  role: UserRole.ACCOUNTANT,
};

const storeDto = {
  content: 'Nota privada de tenant A',
  contextType: ContextType.FINANCIAL_RULE,
};

describe('AgentService — aislamiento multi-tenant', () => {
  it('las memorias de tenant A no son visibles para tenant B', async () => {
    const service = new AgentService();

    await service.storeMemory(tenantA, storeDto);

    const resultA = await service.queryMemory(tenantA, { queryText: 'nota' });
    const resultB = await service.queryMemory(tenantB, { queryText: 'nota' });

    expect(resultA.results.some((memory) => memory.content === storeDto.content)).toBe(true);
    expect(resultB.results.some((memory) => memory.content === storeDto.content)).toBe(false);
  });

  it('el userId de la memoria proviene del contexto, no del dto', async () => {
    const service = new AgentService();

    const memory = await service.storeMemory(tenantA, {
      ...storeDto,
      userId: 'spoofed-user',
      tenantId: 'tenant-B',
    } as any);

    expect(memory.tenantId).toBe('tenant-A');
    expect(memory.userId).toBe('user-A');
  });

  it('respeta topK dentro del tenant correcto', async () => {
    const service = new AgentService();
    await service.storeMemory(tenantA, storeDto);

    const result = await service.queryMemory(tenantA, { queryText: 'nota', topK: 1 });
    expect(result.results).toHaveLength(1);
  });
});

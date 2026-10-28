import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  async storeMemory(data: any) {
    this.logger.log(`Almacenando memoria contextual para tenant: ${data.tenantId}`);
    return {
      id: 'mem-' + Math.random().toString(36).substring(2, 9),
      content: data.content,
      contextType: data.contextType,
      embeddingDimensions: 1536,
      storedAt: new Date().toISOString(),
    };
  }

  async queryMemory(data: any) {
    this.logger.log(`Búsqueda semántica de memoria para tenant: ${data.tenantId}`);
    return {
      query: data.queryText,
      results: [
        {
          id: 'mem-1',
          content: 'El cliente prefiere reportes mensuales consolidados en formato PDF.',
          similarityScore: 0.92,
        },
      ],
    };
  }
}

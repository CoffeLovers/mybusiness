import { Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import Redis from 'ioredis';
import { getMicroserviceRedisOptions, getRedisConfig } from '@mybusiness/common';
import { McpAuditPublisher } from './mcp-audit.publisher';
import { McpController } from './mcp.controller';
import { MCP_RATE_LIMITER, McpToolsService, type RateLimiter } from './mcp-tools.service';

const RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

export type McpRateLimiter = RateLimiter & { close(): Promise<void> };

/**
 * Limitador de ventana fija de 60 segundos apoyado en Redis (`INCR` + `EXPIRE`).
 *
 * Si Redis no responde se degrada a un contador en memoria para no bloquear la
 * herramienta (fail-open): el peor caso es permitir algunas invocaciones extra
 * en una única instancia, nunca denegar tráfico legítimo. El fallback avisa una
 * sola vez para no inundar los logs.
 */
export function createRedisRateLimiter(config: ConfigService): McpRateLimiter {
  const logger = new Logger('McpRateLimiter');
  const configured = Number(
    config.get<string | number>('MCP_RATE_LIMIT_PER_MINUTE', DEFAULT_RATE_LIMIT_PER_MINUTE),
  );
  const limit =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RATE_LIMIT_PER_MINUTE;

  const memory = new Map<string, { count: number; expiresAt: number }>();
  let client: Redis | null = null;
  let warned = false;

  const warnOnce = (error: unknown): void => {
    if (warned) {
      return;
    }
    warned = true;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.warn(
      `Redis no disponible para el rate limit MCP; usando fallback en memoria (${errorName})`,
    );
  };

  const consumeInMemory = (key: string): boolean => {
    const now = Date.now();
    const entry = memory.get(key);

    if (!entry || entry.expiresAt <= now) {
      memory.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_SECONDS * 1000 });
      return limit >= 1;
    }

    entry.count += 1;
    return entry.count <= limit;
  };

  const getClient = (): Redis | null => {
    if (client) {
      return client;
    }

    try {
      client = new Redis({
        ...getRedisConfig(config),
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      client.on('error', () => undefined);
      return client;
    } catch (error) {
      warnOnce(error);
      return null;
    }
  };

  return {
    async consume(key: string): Promise<boolean> {
      const epochMinute = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
      const redisKey = `mcp:rate:${key}:${epochMinute}`;

      try {
        const connection = getClient();
        if (!connection) {
          return consumeInMemory(key);
        }

        if (connection.status === 'wait') {
          await connection.connect();
        }

        const count = await connection.incr(redisKey);
        if (count === 1) {
          await connection.expire(redisKey, RATE_LIMIT_WINDOW_SECONDS);
        }

        return count <= limit;
      } catch (error) {
        warnOnce(error);
        return consumeInMemory(key);
      }
    },

    async close(): Promise<void> {
      if (!client) {
        return;
      }
      const connection = client;
      client = null;
      if (connection.status === 'wait' || connection.status === 'end') {
        connection.disconnect();
        return;
      }
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    },
  };
}

/** Cierra la conexión Redis del limitador al apagar el módulo. */
@Injectable()
class McpRateLimiterLifecycle implements OnModuleDestroy {
  constructor(@Inject(MCP_RATE_LIMITER) private readonly limiter: McpRateLimiter) {}

  async onModuleDestroy(): Promise<void> {
    await this.limiter.close();
  }
}

@Module({
  imports: [ConfigModule],
  controllers: [McpController],
  providers: [
    McpToolsService,
    McpAuditPublisher,
    McpRateLimiterLifecycle,
    {
      provide: 'FINANCE_SERVICE',
      useFactory: (config: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      inject: [ConfigService],
    },
    {
      provide: 'AUDIT_SERVICE',
      useFactory: (config: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      inject: [ConfigService],
    },
    {
      provide: MCP_RATE_LIMITER,
      useFactory: (config: ConfigService) => createRedisRateLimiter(config),
      inject: [ConfigService],
    },
  ],
  exports: [McpToolsService],
})
export class McpModule {}

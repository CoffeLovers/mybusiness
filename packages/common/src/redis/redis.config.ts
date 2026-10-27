import type { ConnectionOptions as BullMQConnectionOptions } from 'bullmq';
import { loadRootEnv } from '../config/env.loader';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  maxRetriesPerRequest?: number | null;
}

export interface ConfigReader {
  get<T = any>(key: string, defaultValue?: T): T | undefined;
}

/**
 * Resuelve la configuración base de Redis a partir de ConfigService, un reader de configuración o process.env.
 * Centraliza la autenticación y parámetros de red para evitar divergencias entre servicios.
 * Falla de forma temprana si falta REDIS_PASSWORD, evitando credenciales hardcodeadas por defecto.
 */
export function getRedisConfig(config?: ConfigReader): RedisConnectionConfig {
  loadRootEnv();

  const host =
    config?.get<string>('REDIS_HOST', 'localhost') || process.env.REDIS_HOST || 'localhost';
  const port = Number(
    config?.get<number | string>('REDIS_PORT', 6379) || process.env.REDIS_PORT || 6379,
  );
  const password = config?.get<string>('REDIS_PASSWORD') || process.env.REDIS_PASSWORD;

  if (!password) {
    throw new Error(
      'REDIS_PASSWORD is required in environment variables or configuration reader. Refusing to fallback to default credentials.',
    );
  }

  return {
    host,
    port,
    password,
  };
}

/**
 * Opciones para el transporte Redis de NestJS Microservices (RPC @MessagePattern y @EventPattern).
 */
export function getMicroserviceRedisOptions(config?: ConfigReader): {
  host: string;
  port: number;
  password?: string;
} {
  const base = getRedisConfig(config);
  return {
    host: base.host,
    port: base.port,
    password: base.password,
  };
}

/**
 * Configuración de conexión segura para colas asíncronas BullMQ.
 *
 * NOTA DE ARQUITECTURA:
 * Redis Pub/Sub (usado en el transporte de microservicios) es un mecanismo volátil 'at-most-once':
 * si el suscriptor está desconectado, los mensajes se descartan.
 * Para trabajos durables que requieren persistencia, reintentos con backoff exponencial,
 * dead-letter queues y control de concurrencia, debe usarse BullMQ sobre la misma infraestructura
 * autenticada de Redis.
 *
 * BullMQ requiere que `maxRetriesPerRequest` sea `null`.
 */
export function getBullMQConnectionOptions(config?: ConfigReader): BullMQConnectionOptions {
  const base = getRedisConfig(config);
  return {
    host: base.host,
    port: base.port,
    password: base.password,
    maxRetriesPerRequest: null,
  };
}

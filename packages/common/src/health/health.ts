import http from 'node:http';

export interface HealthStatusResponse {
  status: 'ok' | 'ready' | 'not_ready';
  service: string;
  uptime: number;
  timestamp: string;
  checks?: Record<string, 'ok' | 'failed' | 'disconnected' | unknown>;
  error?: string;
}

export type ReadinessCheckFn = () => Promise<{
  ok: boolean;
  checks?: Record<string, 'ok' | 'failed' | 'disconnected' | unknown>;
  error?: string;
}>;

export interface AuxiliaryHealthServerOptions {
  serviceName: string;
  port: number;
  host?: string;
  checkReadiness?: ReadinessCheckFn;
}

/**
 * Crea la respuesta de liveness (proceso en ejecución).
 */
export function createLivenessResponse(serviceName: string): HealthStatusResponse {
  return {
    status: 'ok',
    service: serviceName,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Ejecuta y crea la respuesta de readiness (dependencias verificadas).
 */
export async function createReadinessResponse(
  serviceName: string,
  checkReadiness?: ReadinessCheckFn,
): Promise<{ statusCode: number; body: HealthStatusResponse }> {
  const uptime = Math.floor(process.uptime());
  const timestamp = new Date().toISOString();

  if (!checkReadiness) {
    return {
      statusCode: 200,
      body: {
        status: 'ready',
        service: serviceName,
        uptime,
        timestamp,
      },
    };
  }

  try {
    const result = await checkReadiness();
    if (result.ok) {
      return {
        statusCode: 200,
        body: {
          status: 'ready',
          service: serviceName,
          uptime,
          timestamp,
          checks: result.checks,
        },
      };
    }

    return {
      statusCode: 503,
      body: {
        status: 'not_ready',
        service: serviceName,
        uptime,
        timestamp,
        checks: result.checks,
        error: result.error ?? 'Una o más dependencias críticas fallaron',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 503,
      body: {
        status: 'not_ready',
        service: serviceName,
        uptime,
        timestamp,
        error: message,
      },
    };
  }
}

/**
 * Inicia un servidor HTTP auxiliar ligero para Kubernetes/ECS/Nomad health probes.
 */
export function startAuxiliaryHealthServer(options: AuxiliaryHealthServerOptions): http.Server {
  const { serviceName, port, host = '0.0.0.0', checkReadiness } = options;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '';

    if (url === '/healthz/liveness' || url === '/healthz') {
      const response = createLivenessResponse(serviceName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    if (url === '/healthz/readiness') {
      const { statusCode, body } = await createReadinessResponse(serviceName, checkReadiness);
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', url }));
  });

  server.listen(port, host);
  return server;
}

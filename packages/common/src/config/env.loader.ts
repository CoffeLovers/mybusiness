import * as fs from 'fs';
import * as path from 'path';

/**
 * Ruta absoluta del `.env` raíz. Se calcula desde el paquete common para que
 * funcione tanto desde src/config como desde dist/config, sin depender del cwd.
 */
function getRootEnvPath(): string {
  return path.resolve(__dirname, '../../../../.env');
}

/**
 * Carga de forma segura las variables del archivo .env raíz del monorepo si no han sido inyectadas en process.env.
 * Soporta la ejecución de microservicios donde el cwd es apps/<servicio>.
 */
export function loadRootEnv(): void {
  const candidatePaths = [getRootEnvPath(), path.resolve(process.cwd(), '.env')];

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const rawLine of content.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const eqIdx = line.indexOf('=');
          if (eqIdx <= 0) continue;
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
        break;
      } catch {
        // Silencioso si falla la lectura de un archivo candidato
      }
    }
  }
}

/**
 * Retorna las rutas candidatas del archivo .env para ConfigModule.forRoot({ envFilePath: getRootEnvFilePaths() })
 */
export function getRootEnvFilePaths(): string[] {
  return [getRootEnvPath(), path.resolve(process.cwd(), '.env')];
}

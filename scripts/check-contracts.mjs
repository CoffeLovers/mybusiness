/**
 * Verificación de drift para especificación OpenAPI y tipos de cliente web.
 *
 * Regenera el OpenAPI y los tipos TypeScript en un directorio temporal y los compara
 * byte a byte con los archivos versionados en el repositorio.
 * Si detecta discrepancias, imprime el diff legible, escribe un archivo de diff para
 * artefactos de CI y sale con código != 0.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { generateOpenApi } from './generate-openapi.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const versionedSpecPath = resolve(rootDir, 'docs/openapi/api-gateway.json');
const versionedTypesPath = resolve(rootDir, 'apps/web/lib/generated/api-schema.d.ts');

const tmpDir = resolve(rootDir, 'node_modules/.cache/contracts-check');
const tmpSpecPath = resolve(tmpDir, 'api-gateway.json');
const tmpTypesPath = resolve(tmpDir, 'api-schema.d.ts');
const diffArtifactPath = resolve(rootDir, 'contracts-drift.diff');

function simpleUnifiedDiff(oldStr, newStr, oldName, newName) {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  const diff = [];
  diff.push(`--- ${oldName}`);
  diff.push(`+++ ${newName}`);

  const maxLines = Math.max(oldLines.length, newLines.length);
  let changed = false;

  for (let i = 0; i < maxLines; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      changed = true;
      if (o !== undefined) diff.push(`-${o}`);
      if (n !== undefined) diff.push(`+${n}`);
    }
  }

  return changed ? diff.join('\n') : '';
}

async function main() {
  console.log('🔍 Iniciando verificación de drift de contratos OpenAPI y tipos web...');

  if (!existsSync(versionedSpecPath)) {
    console.error(`❌ Falta el archivo versionado: ${versionedSpecPath}`);
    process.exit(1);
  }

  if (!existsSync(versionedTypesPath)) {
    console.error(`❌ Falta el archivo versionado: ${versionedTypesPath}`);
    process.exit(1);
  }

  mkdirSync(tmpDir, { recursive: true });

  // 1. Regenerar OpenAPI en temporal
  await generateOpenApi(tmpSpecPath);

  // 2. Regenerar tipos web en temporal
  try {
    execSync(
      `pnpm --filter @mybusiness/web exec openapi-typescript "${tmpSpecPath}" -o "${tmpTypesPath}" --alphabetize`,
      { cwd: rootDir, stdio: 'pipe' },
    );
  } catch (err) {
    console.error('❌ Error al regenerar los tipos TypeScript con openapi-typescript:');
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    process.exit(1);
  }

  const versionedSpec = readFileSync(versionedSpecPath, 'utf8').replace(/\r\n/g, '\n');
  const tempSpec = readFileSync(tmpSpecPath, 'utf8').replace(/\r\n/g, '\n');

  const versionedTypes = readFileSync(versionedTypesPath, 'utf8').replace(/\r\n/g, '\n');
  const tempTypes = readFileSync(tmpTypesPath, 'utf8').replace(/\r\n/g, '\n');

  let hasDrift = false;
  let fullDiff = '';

  if (versionedSpec !== tempSpec) {
    hasDrift = true;
    console.error('\n❌ DRIFT DETECTADO en docs/openapi/api-gateway.json');
    const specDiff = simpleUnifiedDiff(versionedSpec, tempSpec, 'docs/openapi/api-gateway.json (versionado)', 'openapi generado');
    console.error(specDiff.slice(0, 2000) + (specDiff.length > 2000 ? '\n... (truncado)' : ''));
    fullDiff += specDiff + '\n\n';
  }

  if (versionedTypes !== tempTypes) {
    hasDrift = true;
    console.error('\n❌ DRIFT DETECTADO en apps/web/lib/generated/api-schema.d.ts');
    const typesDiff = simpleUnifiedDiff(versionedTypes, tempTypes, 'apps/web/lib/generated/api-schema.d.ts (versionado)', 'tipos generados');
    console.error(typesDiff.slice(0, 2000) + (typesDiff.length > 2000 ? '\n... (truncado)' : ''));
    fullDiff += typesDiff + '\n\n';
  }

  if (hasDrift) {
    writeFileSync(diffArtifactPath, fullDiff, 'utf8');
    console.error(`\n📄 Diff completo guardado en: ${diffArtifactPath}`);
    console.error('💡 Solución: ejecuta "pnpm contracts:generate" para regenerar y confirmar los cambios en Git.');
    process.exit(1);
  }

  console.log('✓ Contratos OpenAPI y tipos web perfectamente sincronizados (0 drift).');
}

main().catch((err) => {
  console.error('Error durante verificación de contratos:', err);
  process.exit(1);
});

/**
 * Script de verificación estricta de paridad de contratos entre OpenAPI y DTOs Kotlin.
 *
 * Requisitos:
 * - Lee la especificación OpenAPI (docs/openapi/api-gateway.json).
 * - Lee el mapa declarativo contracts/kotlin-contract-map.json.
 * - Inspecciona el código Kotlin de apps/mobile-android/core/network/.../dto/ y core/model/.
 * - Comprueba que:
 *   1. Todos los DTOs de red de Android están mapeados (no faltan DTOs).
 *   2. Cada campo del esquema OpenAPI existe en Kotlin o está declarado en allowlistSchemaFields.
 *   3. Cada campo de Kotlin existe en OpenAPI o está declarado en allowlistKotlinFields.
 *   4. Falla con código 1 ante cualquier deriva no autorizada.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const openApiPath = resolve(rootDir, 'docs/openapi/api-gateway.json');
const mapPath = resolve(rootDir, 'contracts/kotlin-contract-map.json');
const dtsDir = resolve(rootDir, 'apps/mobile-android/core/network/src/main/java/com/mybusiness/core/network/dto');

/**
 * Parsea un archivo Kotlin y extrae los campos de cada data class definida.
 * Retorna un mapa: { [className]: string[] }
 */
function extractKotlinDataClasses(fileContent) {
  // Eliminar comentarios de bloque y de línea para evitar que paréntesis en comentarios afecten el regex
  const cleanContent = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const classes = {};
  // Expresión regular para encontrar `data class NombreClass(...)`
  const classRegex = /(?:@Serializable\s+)?(?:data\s+)?class\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)/g;

  let match;
  while ((match = classRegex.exec(cleanContent)) !== null) {
    const className = match[1];
    const paramsBlock = match[2];

    const fields = [];
    const fieldRegex = /(?:val|var)\s+([A-Za-z0-9_]+)\s*:/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(paramsBlock)) !== null) {
      fields.push(fieldMatch[1]);
    }

    classes[className] = fields;
  }

  return classes;
}

function main() {
  console.log('🤖 Verificando paridad de contratos entre OpenAPI y DTOs Kotlin...');

  if (!existsSync(openApiPath)) {
    console.error(`❌ No se encontró la especificación OpenAPI en: ${openApiPath}`);
    console.error('Ejecuta primero: pnpm contracts:generate');
    process.exit(1);
  }

  if (!existsSync(mapPath)) {
    console.error(`❌ No se encontró el mapa de contratos en: ${mapPath}`);
    process.exit(1);
  }

  const openApiDoc = JSON.parse(readFileSync(openApiPath, 'utf8'));
  const schemas = openApiDoc.components?.schemas || {};
  const mapConfig = JSON.parse(readFileSync(mapPath, 'utf8'));

  let errors = [];

  // 1. Verificar cobertura de todos los archivos DTO en core/network/.../dto
  const dtoFiles = readdirSync(dtsDir).filter((file) => file.endsWith('.kt'));
  for (const file of dtoFiles) {
    const mapped = mapConfig.mappings.some((m) => m.source.endsWith(file));
    if (!mapped) {
      errors.push(`DTO Kotlin sin mapeo: ${file} no está declarado en contracts/kotlin-contract-map.json`);
    }
  }

  // 2. Cache de archivos Kotlin parseados
  const parsedKotlinFiles = new Map();

  for (const mapping of mapConfig.mappings) {
    const fullSourcePath = resolve(rootDir, mapping.source);
    if (!existsSync(fullSourcePath)) {
      errors.push(`Archivo fuente no encontrado: ${mapping.source}`);
      continue;
    }

    if (!parsedKotlinFiles.has(fullSourcePath)) {
      const content = readFileSync(fullSourcePath, 'utf8');
      parsedKotlinFiles.set(fullSourcePath, extractKotlinDataClasses(content));
    }

    const fileClasses = parsedKotlinFiles.get(fullSourcePath);
    const kotlinFields = fileClasses[mapping.kotlinClass];

    if (!kotlinFields) {
      errors.push(`Clase Kotlin "${mapping.kotlinClass}" no encontrada en ${mapping.source}`);
      continue;
    }

    const schema = schemas[mapping.schema];
    if (!schema) {
      errors.push(`Esquema OpenAPI "${mapping.schema}" no existe en ${openApiPath}`);
      continue;
    }

    const schemaProperties = Object.keys(schema.properties || {});
    const allowKotlin = new Set(mapping.allowlistKotlinFields || []);
    const allowSchema = new Set(mapping.allowlistSchemaFields || []);

    // A. Cada campo del esquema OpenAPI debe estar en Kotlin o en allowlistSchemaFields
    for (const schemaField of schemaProperties) {
      if (!kotlinFields.includes(schemaField) && !allowSchema.has(schemaField)) {
        errors.push(
          `Deriva en [${mapping.kotlinClass} ↔ ${mapping.schema}]: el campo de esquema "${schemaField}" no existe en Kotlin y no está en allowlistSchemaFields.`,
        );
      }
    }

    // B. Cada campo de Kotlin debe estar en el esquema OpenAPI o en allowlistKotlinFields
    for (const kotlinField of kotlinFields) {
      if (!schemaProperties.includes(kotlinField) && !allowKotlin.has(kotlinField)) {
        errors.push(
          `Deriva en [${mapping.kotlinClass} ↔ ${mapping.schema}]: el campo Kotlin "${kotlinField}" no existe en el esquema OpenAPI y no está en allowlistKotlinFields.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Se encontraron ${errors.length} violaciones de contrato Kotlin/OpenAPI:`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error('\nActualiza los DTOs Kotlin o documenta los campos intencionales en contracts/kotlin-contract-map.json con su justificación.');
    process.exit(1);
  }

  console.log(`✓ Verificación Kotlin exitosa: ${mapConfig.mappings.length} clases validadas contra OpenAPI sin drift no autorizado.`);
}

main();

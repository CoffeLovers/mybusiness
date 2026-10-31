# Documentos, OCR y búsqueda semántica — SF2-07

> `finance-service` recibe documentos, los guarda en almacenamiento de objetos y los procesa con OCR en una cola durable. Los embeddings viven en `agent-service` (pgvector).

## Flujo

1. `POST /api/v1/documents` (multipart, `file`) → gateway valida MIME y tamaño (PDF/JPEG/PNG, 10 MB) y llama por RPC a `documents.create`.
2. `finance-service` calcula SHA-256, guarda el binario con la clave `<tenantId>/<sha256>.<ext>` y registra el documento en `documents` (UNIQUE `tenant_id + checksum_sha256`: una resubida no crea otro documento ni reencola).
3. Se publica un job en la cola `ocr` con `jobId = sha256(cola+checksum)`: idempotente ante reintentos.
4. El worker descarga el archivo, extrae datos con el `OcrProvider` configurado, normaliza importes a unidad menor y decide:
   - `confidence ≥ OCR_CONFIDENCE_THRESHOLD` (0.85) → `EXTRACTED`.
   - `confidence < 0.85` → `NEEDS_REVIEW` (no se concilia automáticamente).
   - error → `FAILED` y el job se reintenta con backoff.
5. El texto normalizado se indexa en `agent-service` (`ContextType.DOCUMENT`) vía `agent.memory.store`; la búsqueda usa `agent.memory.search` y luego filtra documentos por tenant.

## Estados

| Estado         | Significado                                  |
| -------------- | -------------------------------------------- |
| `PENDING`      | Registrado, OCR pendiente                    |
| `PROCESSING`   | Worker en curso                              |
| `EXTRACTED`    | Datos completos y confianza suficiente       |
| `NEEDS_REVIEW` | Confianza < umbral; requiere revisión humana |
| `FAILED`       | Error definitivo o reintentos agotados       |

## Endpoints

| Método | Ruta                             | Descripción                              |
| ------ | -------------------------------- | ---------------------------------------- |
| POST   | `/api/v1/documents`              | Subida multipart (`file`)                |
| GET    | `/api/v1/documents/:id`          | Metadatos del documento (tenant del JWT) |
| GET    | `/api/v1/documents/search?q=`    | Búsqueda semántica acotada al tenant     |
| GET    | `/api/v1/documents/:id/download` | URL firmada temporal (S3)                |

## Almacenamiento

`DOCUMENT_STORAGE_DRIVER=local` escribe en `DOCUMENTS_LOCAL_DIR` (solo desarrollo). En S3/MinIO se usa `S3_ENDPOINT`, `S3_BUCKET`, credenciales y `S3_FORCE_PATH_STYLE=true`; la descarga se entrega como URL firmada de 5 minutos y el binario nunca se sirve sin autorización del tenant.

`docker compose up -d minio minio-init` crea el bucket automáticamente.

## OCR

| `OCR_PROVIDER` | Uso                                                         |
| -------------- | ----------------------------------------------------------- |
| `stub`         | Desarrollo y tests: factura determinista con confianza 0.97 |
| `mindee`       | Producción: `MINDEE_API_KEY`, modelo `invoices`             |

La normalización convierte importes con coma o punto decimal a unidad menor (`string`), fechas a ISO y valida la moneda ISO-4217.

## Pruebas

```bash
pnpm --filter @mybusiness/finance-service test      # normalización, storage, servicio
pnpm --filter @mybusiness/finance-service test:e2e  # PostgreSQL real
pnpm --filter @mybusiness/api-gateway test          # multipart, límites y contexto
```

## Límites conocidos

- El stub no lee el contenido del archivo; los E2E validan el flujo, no la calidad del OCR real.
- La búsqueda depende de `agent-service`; si falla, `search` devuelve una lista vacía (degradación explícita).
- No hay antivirus ni verificación de PDF malicioso; el OCR se ejecuta en un proveedor externo.

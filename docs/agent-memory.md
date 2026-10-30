# Memoria vectorial — `agent-service`

> Implementado en la issue #14. Búsqueda semántica con PostgreSQL + pgvector.

## Modelo

`agent_memories` almacena `tenantId`, `userId` opcional, `content`, `embedding vector(1536)`, `contextType`, `metadata` y `createdAt`. El índice HNSW usa `vector_cosine_ops`.

## Invariantes

1. **Identidad sólo desde el contexto RPC.** `tenantId` y `userId` provienen de `RequestContext`; los DTOs no aceptan identidad ni vectores del cliente.
2. **Embedding siempre generado en el servidor.** El cliente envía texto; el proveedor configurado genera el vector de 1536 dimensiones.
3. **Aislamiento por tenant.** Toda consulta filtra por `tenantId`; la búsqueda no cruza tenants.
4. **Sin vectores en la respuesta.** El repositorio no proyecta la columna `embedding`.
5. **Parámetros acotados.** `topK` entero entre 1 y 50; `threshold` entre 0 y 1.

## Proveedores

| `EMBEDDING_PROVIDER` | Uso                | Requisitos                                                            |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `mock`               | Desarrollo y tests | Ninguno; vector determinista                                          |
| `openai`             | Producción         | `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, opcional `EMBEDDING_BASE_URL` |

El arranque falla si el proveedor es desconocido o si en producción se configura `mock`.

## Búsqueda

`1 - (embedding <=> query)` se expone como `similarityScore`; el orden es ascendente por distancia coseno. `threshold` filtra por similitud mínima.

## Pruebas

```bash
pnpm --filter @mybusiness/agent-service test      # unitarios, sin base de datos
pnpm --filter @mybusiness/agent-service test:e2e  # requiere AGENT_DATABASE_URL
```

La e2e se omite sin `AGENT_DATABASE_URL`. En CI, el job `test-e2e` levanta `pgvector/pgvector:pg16` en el puerto 5433, crea la extensión y migra.

## Límites conocidos

- Sin re-ranking ni filtros híbridos (texto + vector); se evaluará con la Fase 3.
- El proveedor no implementa reintentos; un fallo del proveedor devuelve error al llamador.

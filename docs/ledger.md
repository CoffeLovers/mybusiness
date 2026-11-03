# Libro mayor

Pantalla `/libro-mayor` para consultar, filtrar, clasificar y exportar los
movimientos financieros del negocio. La página es un Server Component que
resuelve la sesión y trae la primera página; la interacción posterior vive en
`LedgerView` (`apps/web/components/ledger/ledger-view.tsx`) y habla con el BFF,
nunca directamente con el gateway.

## Endpoints

Todas las rutas exigen sesión válida y añaden el access token en el servidor.
Las mutaciones requieren, además, `Origin` permitido y el token CSRF de doble
envío (`x-csrf-token` + cookie `mb_csrf`).

| Método   | BFF                           | Gateway                                  |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/api/ledger`                 | `/api/v1/finance/ledger`                 |
| `GET`    | `/api/ledger/export`          | `/api/v1/finance/ledger/export.csv`      |
| `PATCH`  | `/api/ledger/:id`             | `/api/v1/finance/ledger/:id`             |
| `POST`   | `/api/ledger/bulk-categorize` | `/api/v1/finance/ledger/bulk-categorize` |
| `GET`    | `/api/ledger/saved-views`     | `/api/v1/finance/ledger/saved-views`     |
| `POST`   | `/api/ledger/saved-views`     | `/api/v1/finance/ledger/saved-views`     |
| `DELETE` | `/api/ledger/saved-views/:id` | `/api/v1/finance/ledger/saved-views/:id` |

### `GET /api/v1/finance/ledger`

Lista paginada. La respuesta es `{ rows, total, page, pageSize, hasMore }`.

Parámetros y whitelists (`apps/web/lib/ledger/query.ts`):

| Parámetro              | Regla                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| `page`                 | entero ≥ 1 (por defecto `1`)                                              |
| `pageSize`             | entero entre `10` y `200` (por defecto `50`)                              |
| `sortBy`               | `date`, `amount`, `name`, `category`, `status` (por defecto `date`)       |
| `sortDir`              | `asc`, `desc` (por defecto `desc`)                                        |
| `from` / `to`          | `YYYY-MM-DD` con fecha real; si `from > to` se descartan ambas            |
| `q`                    | texto ≤ 200 caracteres (se recorta); por encima se descarta               |
| `category`             | texto ≤ 200 caracteres                                                    |
| `reconciliationStatus` | `UNMATCHED`, `AUTO_MATCHED`, `MANUAL_MATCHED`, `NEEDS_REVIEW`, `REJECTED` |
| `accountId`            | UUID con forma válida                                                     |

El parseo nunca lanza: cualquier valor inválido cae al default o se descarta,
de modo que una URL manipulada no rompe la página ni el BFF. La serialización
respeta un orden fijo (`page`, `pageSize`, `sortBy`, `sortDir`, `from`, `to`,
`q`, `category`, `reconciliationStatus`, `accountId`) para que las URLs sean
estables y comparables.

### `GET /api/v1/finance/ledger/export.csv`

Descarga la selección actual como CSV. El BFF reenvía `content-type` y
`content-disposition` del gateway para que el navegador use el nombre correcto
(`libro-mayor.csv` por defecto). El cuerpo incluye BOM UTF-8 y la cabecera
`fecha,descripcion,comercio,importe,moneda,categoria,conciliacion,cuenta`.

### `PATCH /api/v1/finance/ledger/:id`

Edita únicamente `category` (≤ 200) y `notes` (≤ 1000). El `id` debe ser un
UUID con forma válida; el BFF descarta cualquier otra clave del cuerpo antes de
reenviarlo. En la UI la edición es optimista: el valor se pinta al instante, se
hace `PATCH` con CSRF y, si el gateway falla, se revierte y se anuncia el
código de error por `aria-live`.

### `POST /api/v1/finance/ledger/bulk-categorize`

Cuerpo `{ ids: string[], category: string }`. El BFF rechaza lotes vacíos, con
más de **500** identificadores (`too_many_rows`) o con ids que no sean UUID
válidos, y devuelve `{ updated, requested }`. La UI pide confirmación explícita
antes de aplicar y limpia la selección al terminar.

### Vistas guardadas

`GET` devuelve la lista; `POST` crea una vista con `{ name, query }` (nombre de
1 a 100 caracteres; la consulta se normaliza contra la whitelist antes de
persistirla) y `DELETE :id` la elimina. El estado es por usuario y el control
de la UI lo gestiona de forma local.

## RBAC

- Sin sesión: `401 session_required`.
- Origen no permitido: `403 origin_not_allowed`.
- CSRF ausente o inválido en mutaciones: `403 csrf_invalid`.
- El aislamiento por tenant lo aplica el gateway a partir del token; el BFF
  nunca acepta `tenantId` del cliente. La exportación y las vistas guardadas
  respetan el mismo alcance.

## Límites

- **200** filas por página (`pageSize` máximo).
- **500** filas por lote de recategorización.
- **50.000** filas por exportación (tope defensivo del gateway).
- **8 s** de timeout por petición al gateway.

## Virtualización y paginación server-side

Las 50.000 filas **no** se cargan en el cliente. El navegador recibe sólo la
página pedida (50 por defecto) y el total; TanStack Table trabaja en modo
manual (`manualPagination`/`manualSorting`) y TanStack Virtual renderiza sólo
las filas visibles más un overscan sobre un contenedor de altura fija. Así el
DOM se mantiene pequeño aunque el conjunto sea grande, y ordenar o filtrar
implica una petición al servidor —y no un reordenamiento en memoria—. La URL se
actualiza con `history.replaceState`, de modo que compartir el enlace conserva
la consulta sin recargar la pantalla.

## Auditoría

El gateway registra las mutaciones con eventos estables:

- `ledger.transaction.updated` al editar categoría o notas.
- `ledger.transactions.bulk_categorized` al aplicar una categoría en lote.

Los eventos incluyen el identificador de la transacción (o el recuento y los
ids del lote), el actor y el tenant, sin volcar notas ni contenido sensible en
los logs.

## Anti-CSV-injection

La exportación escapa comillas, comas y saltos de línea según RFC 4180. Los
valores que empiezan por `=`, `+`, `-` o `@` deben neutralizarse en el
generador (prefijo `'`) para que una hoja de cálculo no los interprete como
fórmulas; el cliente nunca construye el CSV, sólo descarga el que produce el
gateway. La cabecera incluye BOM para que Excel detecte UTF-8.

## Limitaciones conocidas

- Sólo se editan **categoría** y **notas**; importe, fecha, cuenta y evidencia
  son de solo lectura desde esta pantalla.
- El **estado de conciliación es de solo lectura**: se deriva de
  `reconciliation_matches` y se modifica desde el flujo de conciliación.
- La edición en línea no ofrece edición múltiple de notas, sólo de categoría.
- El mock de E2E fuerza el conflicto de edición mediante el valor `__fail` (o
  un id terminado en `-fail` en llamadas directas al gateway); no representa
  una regla de negocio real.

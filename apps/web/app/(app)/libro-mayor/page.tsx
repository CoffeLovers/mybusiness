/**
 * Página del libro mayor.
 *
 * El servidor resuelve la sesión y trae la primera página junto con las vistas
 * guardadas; si el gateway falla se marca `error` y la vista muestra un aviso
 * explícito en lugar de datos inventados. Los filtros se leen de la URL con
 * `parseLedgerQuery`, que nunca lanza.
 */

import type { LedgerPageResponse, SavedLedgerViewResponse } from '@mybusiness/contracts';

import { LedgerView } from '@/components/ledger/ledger-view';
import { ledgerQueryToSearchParams, parseLedgerQuery } from '@/lib/ledger/query';
import { gatewayFetch } from '@/lib/server/gateway-client';
import { readSession } from '@/lib/session/server';

export const metadata = {
  title: 'Libro mayor · Asistente Financiero',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const SAVED_VIEWS_PATH = '/api/v1/finance/ledger/saved-views';

export default async function LibroMayorPage({ searchParams }: PageProps) {
  const session = await readSession();
  const query = parseLedgerQuery((await searchParams) ?? {});

  let page: LedgerPageResponse = {
    rows: [],
    total: 0,
    page: query.page,
    pageSize: query.pageSize,
    hasMore: false,
  };
  let savedViews: SavedLedgerViewResponse[] = [];
  let initialError = false;

  if (session === null) {
    initialError = true;
  } else {
    const accessToken = session.accessToken;

    try {
      [page, savedViews] = await Promise.all([
        gatewayFetch<LedgerPageResponse>(
          `/api/v1/finance/ledger?${ledgerQueryToSearchParams(query).toString()}`,
          { accessToken },
        ),
        gatewayFetch<SavedLedgerViewResponse[]>(SAVED_VIEWS_PATH, { accessToken }),
      ]);
    } catch {
      // Un fallo del gateway no debe inventar filas: la vista explica el estado.
      initialError = true;
      savedViews = [];
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold text-text">Libro mayor</h1>
        <p className="text-base text-text-muted">
          Consulta, filtra y clasifica los movimientos de tu negocio. Los cambios se guardan al
          instante y puedes recategorizar varios movimientos a la vez.
        </p>
      </header>

      <LedgerView
        initialPage={page}
        initialQuery={query}
        savedViews={savedViews}
        initialError={initialError}
      />
    </section>
  );
}

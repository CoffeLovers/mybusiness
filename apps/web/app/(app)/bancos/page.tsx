/**
 * Página de bancos (solo lectura + sincronización/desvinculación).
 *
 * El servidor resuelve la sesión y trae las conexiones junto con las cuentas de
 * cada conexión activa. Si el gateway falla se marca `initialError` y la vista
 * explica el estado sin inventar datos. La vinculación de nuevas cuentas no se
 * implementa aquí: requiere el widget de Plaid y credenciales públicas, así que
 * se realiza desde la app Android o por API.
 */

import type { BankAccountResponse, BankConnectionResponse } from '@mybusiness/contracts';

import { BanksView } from '@/components/banking/banks-view';
import { gatewayFetch } from '@/lib/server/gateway-client';
import { readSession } from '@/lib/session/server';

export const metadata = {
  title: 'Bancos · Asistente Financiero',
};

const CONNECTIONS_PATH = '/api/v1/banking/connections';

/** El estado puede llegar en minúsculas (contrato) o mayúsculas (mocks). */
function isActiveConnection(connection: BankConnectionResponse): boolean {
  return connection.status.toLowerCase() === 'active';
}

export default async function BancosPage() {
  const session = await readSession();

  let connections: BankConnectionResponse[] = [];
  let accountsByConnection: Record<string, BankAccountResponse[]> = {};
  let initialError = false;

  if (session === null) {
    initialError = true;
  } else {
    const accessToken = session.accessToken;

    try {
      connections = await gatewayFetch<BankConnectionResponse[]>(CONNECTIONS_PATH, { accessToken });

      const activeConnections = connections.filter(isActiveConnection);
      const entries = await Promise.all(
        activeConnections.map(async (connection) => {
          const accounts = await gatewayFetch<BankAccountResponse[]>(
            `${CONNECTIONS_PATH}/${encodeURIComponent(connection.id)}/accounts`,
            { accessToken },
          );

          return [connection.id, accounts] as const;
        }),
      );

      accountsByConnection = Object.fromEntries(entries);
    } catch {
      // Un fallo del gateway no debe inventar conexiones ni cuentas.
      initialError = true;
      connections = [];
      accountsByConnection = {};
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold text-text">Bancos</h1>
        <p className="text-base text-text-muted">Cuentas vinculadas y estado de sincronización</p>
      </header>

      <BanksView
        connections={connections}
        accountsByConnection={accountsByConnection}
        initialError={initialError}
      />
    </section>
  );
}

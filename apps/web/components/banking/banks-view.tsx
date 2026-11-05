'use client';

/**
 * Vista de bancos: conexiones, cuentas y acciones de sincronización.
 *
 * Es de sólo lectura salvo dos mutaciones (sincronizar y desvincular), que
 * pasan por el BFF con el token CSRF de doble envío. La vinculación de nuevas
 * cuentas no se ofrece aquí porque requiere el widget de Plaid (SDK y
 * credenciales públicas): el usuario la completa desde la app Android o por API.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type {
  BankAccountResponse,
  BankConnectionResponse,
  SyncConnectionResponse,
} from '@mybusiness/contracts';

import { Button, Card, Chip, Skeleton } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { formatMinorUnitsString } from '@/lib/format';

/** Cookie CSRF de doble envío (la única legible por el cliente). */
const CSRF_COOKIE = 'mb_csrf';

const STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  pending: 'Pendiente',
  needs_reauth: 'Requiere reconexión',
  error: 'Error',
  disconnected: 'Desvinculada',
  revoked: 'Revocada',
  removed: 'Eliminada',
};

const STATUS_TONES: Record<string, ChipTone> = {
  active: 'income',
  pending: 'neutral',
  needs_reauth: 'alert',
  error: 'expense',
  disconnected: 'neutral',
  revoked: 'neutral',
  removed: 'neutral',
};

const connectionDateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export interface BanksViewProps {
  connections: BankConnectionResponse[];
  accountsByConnection: Record<string, BankAccountResponse[]>;
  initialError?: boolean;
}

/** Lee una cookie no httpOnly; `undefined` si no existe o está vacía. */
function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  const rawValue = match?.[1];

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}

/** Cabecera CSRF para mutaciones; vacía si la cookie aún no existe. */
function csrfHeaders(): Record<string, string> {
  const token = readCookie(CSRF_COOKIE);

  return token === undefined ? {} : { 'x-csrf-token': token };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Código de error estable del BFF; nunca se muestra el cuerpo remoto. */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Respuesta sin JSON: se usa el código HTTP.
  }

  return `http_${String(response.status)}`;
}

function errorCode(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : 'error';
}

function statusKey(status: string): string {
  return status.toLowerCase();
}

function statusLabel(status: string): string {
  const key = statusKey(status);

  return STATUS_LABELS[key] ?? status;
}

function statusTone(status: string): ChipTone {
  return STATUS_TONES[statusKey(status)] ?? 'neutral';
}

function providerLabel(provider: string): string {
  if (provider.toLowerCase() === 'plaid') {
    return 'Plaid';
  }

  if (provider.toLowerCase() === 'belvo') {
    return 'Belvo';
  }

  return provider;
}

function institutionName(connection: BankConnectionResponse): string {
  const name = connection.institutionName?.trim();

  return name !== undefined && name.length > 0 ? name : 'Institución sin nombre';
}

function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return connectionDateFormatter.format(date);
}

function formatBalance(account: BankAccountResponse): string {
  if (account.balanceCurrentMinor === null || account.balanceCurrentMinor === undefined) {
    return '—';
  }

  try {
    return formatMinorUnitsString(account.balanceCurrentMinor, account.isoCurrencyCode);
  } catch {
    return account.balanceCurrentMinor;
  }
}

function maskLabel(mask: string | null | undefined): string | null {
  const value = mask?.trim();

  return value !== undefined && value.length > 0 ? `•••• ${value}` : null;
}

interface ConnectionCardProps {
  connection: BankConnectionResponse;
  accounts: BankAccountResponse[];
  syncing: boolean;
  disconnecting: boolean;
  onSync: (connection: BankConnectionResponse) => void;
  onDisconnect: (connection: BankConnectionResponse) => void;
}

function ConnectionCard({
  connection,
  accounts,
  syncing,
  disconnecting,
  onSync,
  onDisconnect,
}: ConnectionCardProps) {
  const name = institutionName(connection);
  const busy = syncing || disconnecting;

  return (
    <Card role="group" aria-label={`Conexión ${name}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-text">{name}</h2>
          <p className="text-sm text-text-muted">
            Proveedor: {providerLabel(connection.provider)} · Última sincronización:{' '}
            {formatDateTime(connection.lastSuccessfulSyncAt)}
          </p>
        </div>
        <Chip tone={statusTone(connection.status)}>{statusLabel(connection.status)}</Chip>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-text-muted">Esta conexión aún no tiene cuentas disponibles.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => {
            const mask = maskLabel(account.mask);

            return (
              <li
                key={account.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface px-3 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-text">{account.name}</span>
                  <span className="text-xs text-text-muted">
                    {mask ?? 'Sin máscara'} · {account.isoCurrencyCode}
                  </span>
                  <span className="text-xs text-text-muted">
                    Sincronizada: {formatDateTime(account.lastSyncedAt)}
                  </span>
                </div>
                <span className="tabular-nums text-sm font-semibold text-text">
                  {formatBalance(account)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onSync(connection);
          }}
          loading={syncing}
          disabled={busy}
          aria-label={`Sincronizar ${name}`}
        >
          Sincronizar
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onDisconnect(connection);
          }}
          loading={disconnecting}
          disabled={busy}
          aria-label={`Desvincular ${name}`}
        >
          Desvincular
        </Button>
      </div>
    </Card>
  );
}

export function BanksView({
  connections,
  accountsByConnection,
  initialError = false,
}: BanksViewProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setRefreshing(false);
  }, [connections]);

  const refresh = () => {
    setRefreshing(true);
    router.refresh();
  };

  const handleSync = async (connection: BankConnectionResponse) => {
    const name = institutionName(connection);

    setActionError(null);
    setSyncingId(connection.id);

    try {
      const response = await fetch(
        `/api/banking/connections/${encodeURIComponent(connection.id)}/sync`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders(),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorCode(response));
      }

      const result = (await response.json()) as SyncConnectionResponse;

      setAnnouncement(
        `Sincronización de ${name} completada: ${String(result.added)} añadidos, ${String(
          result.modified,
        )} actualizados, ${String(result.removed)} eliminados.`,
      );
      refresh();
    } catch (cause) {
      const message = `No se pudo sincronizar ${name} (${errorCode(cause)}).`;

      setActionError(message);
      setAnnouncement(message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (connection: BankConnectionResponse) => {
    const name = institutionName(connection);
    const confirmed = window.confirm(
      `¿Desvincular ${name}? Se dejarán de sincronizar sus cuentas hasta que vuelvas a vincularlas.`,
    );

    if (!confirmed) {
      return;
    }

    setActionError(null);
    setDisconnectingId(connection.id);

    try {
      const response = await fetch(
        `/api/banking/connections/${encodeURIComponent(connection.id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: csrfHeaders(),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorCode(response));
      }

      setAnnouncement(`${name} desvinculada.`);
      refresh();
    } catch (cause) {
      const message = `No se pudo desvincular ${name} (${errorCode(cause)}).`;

      setActionError(message);
      setAnnouncement(message);
    } finally {
      setDisconnectingId(null);
    }
  };

  const isBusy = syncingId !== null || disconnectingId !== null;

  return (
    <section className="flex flex-col gap-4" aria-busy={isBusy}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {initialError ? (
        <Card role="alert" className="flex flex-col items-start gap-3 border-expense/30">
          <p className="text-sm text-expense">
            No se pudieron cargar las conexiones bancarias. Vuelve a intentarlo en unos segundos.
          </p>
          <Button variant="secondary" onClick={refresh} loading={refreshing}>
            Reintentar
          </Button>
        </Card>
      ) : null}

      {!initialError && actionError !== null ? (
        <Card role="alert" className="flex flex-col items-start gap-3 border-expense/30">
          <p className="text-sm text-expense">{actionError}</p>
          <Button variant="secondary" onClick={refresh} loading={refreshing}>
            Reintentar
          </Button>
        </Card>
      ) : null}

      {initialError ? null : refreshing && connections.length === 0 ? (
        <Card aria-label="Cargando conexiones bancarias">
          <Skeleton lines={4} />
        </Card>
      ) : connections.length === 0 ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text">No hay cuentas vinculadas</h2>
          <p className="text-sm text-text-muted">
            Vincula tu banco desde la app Android o completa el exchange por API
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              accounts={accountsByConnection[connection.id] ?? []}
              syncing={syncingId === connection.id}
              disconnecting={disconnectingId === connection.id}
              onSync={(target) => {
                void handleSync(target);
              }}
              onDisconnect={(target) => {
                void handleDisconnect(target);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

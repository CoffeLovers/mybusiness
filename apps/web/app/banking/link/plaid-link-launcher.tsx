'use client';

/**
 * Lanzador de Plaid Link para el portal web.
 *
 * Carga el script oficial desde el CDN de Plaid (sin dependencia npm), abre el
 * widget con el `link_token` acuñado por el BFF y devuelve al usuario a la
 * página de bancos con el `public_token` o con el estado de cancelación.
 */

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface PlaidHandler {
  open: () => void;
}

interface PlaidLinkOptions {
  token: string;
  onSuccess: (publicToken: string, metadata: unknown) => void;
  onExit: (error: unknown) => void;
}

interface PlaidFactory {
  create: (options: PlaidLinkOptions) => PlaidHandler;
}

/** Promesa compartida: un único script aunque el componente se monte dos veces. */
let plaidScriptPromise: Promise<PlaidFactory> | null = null;

/** Extrae la fábrica tipada de `window.Plaid`; `null` si aún no está lista. */
function readPlaidFactory(): PlaidFactory | null {
  const candidate: unknown = (window as unknown as { Plaid?: unknown }).Plaid;

  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const create: unknown = (candidate as { create?: unknown }).create;

  return typeof create === 'function' ? (candidate as PlaidFactory) : null;
}

/** Inyecta el script oficial una sola vez y resuelve cuando `window.Plaid` existe. */
function loadPlaidScript(): Promise<PlaidFactory> {
  const ready = readPlaidFactory();

  if (ready !== null) {
    return Promise.resolve(ready);
  }

  if (plaidScriptPromise !== null) {
    return plaidScriptPromise;
  }

  plaidScriptPromise = new Promise<PlaidFactory>((resolve, reject) => {
    const script = document.createElement('script');

    script.src = PLAID_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const factory = readPlaidFactory();

      if (factory === null) {
        plaidScriptPromise = null;
        reject(new Error('plaid_unavailable'));
        return;
      }

      resolve(factory);
    };
    script.onerror = () => {
      plaidScriptPromise = null;
      script.remove();
      reject(new Error('plaid_script_failed'));
    };

    document.head.appendChild(script);
  });

  return plaidScriptPromise;
}

/** Añade un parámetro de consulta conservando los que ya traiga la base. */
function withQuery(base: string, key: string, value: string): string {
  const separator = base.includes('?') ? '&' : '?';

  return `${base}${separator}${key}=${encodeURIComponent(value)}`;
}

type LaunchState = 'loading' | 'opened' | 'error';

export interface PlaidLinkLauncherProps {
  token: string;
  /** Ruta a la que se vuelve tras el éxito o la cancelación (ya validada). */
  returnTo: string;
}

export function PlaidLinkLauncher({ token, returnTo }: PlaidLinkLauncherProps) {
  const [state, setState] = useState<LaunchState>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setState('loading');

    loadPlaidScript()
      .then((factory) => {
        if (cancelled) {
          return;
        }

        const handler = factory.create({
          token,
          onSuccess: (publicToken) => {
            window.location.assign(withQuery(returnTo, 'public_token', publicToken));
          },
          onExit: () => {
            window.location.assign(withQuery(returnTo, 'status', 'cancelled'));
          },
        });

        handler.open();
        setState('opened');
      })
      .catch(() => {
        if (!cancelled) {
          setState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, returnTo, token]);

  const retry = () => {
    setAttempt((current) => current + 1);
  };

  if (token.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold text-text">Enlace inválido o expirado</h2>
        <p className="text-sm text-text-muted">
          Este enlace ya no sirve para vincular tu banco. Vuelve a bancos y solicita uno nuevo.
        </p>
        <a
          href="/bancos"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary/90"
        >
          Volver a bancos
        </a>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold text-text">No se pudo abrir Plaid Link</h2>
        <p className="text-sm text-text-muted">
          Revisa tu conexión y vuelve a intentarlo. Tus datos no se han enviado.
        </p>
        <Button variant="primary" size="lg" onClick={retry}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <p role="status" aria-live="polite" className="text-sm text-text-muted">
      {state === 'opened'
        ? 'Plaid Link está abierto. Completa la conexión en la ventana del proveedor.'
        : 'Conectando con Plaid…'}
    </p>
  );
}

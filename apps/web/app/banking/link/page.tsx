/**
 * Página pública de vinculación bancaria (`/banking/link`).
 *
 * Vive fuera del grupo `(app)` a propósito: Plaid puede devolver al usuario a
 * esta URL y sólo necesitamos el `link_token` de la consulta. No lee la sesión
 * ni muestra datos del negocio; el canje del `public_token` ocurre después en
 * `/bancos`, ya autenticado.
 */

import type { Metadata } from 'next';

import { Card } from '@/components/ui';

import { PlaidLinkLauncher } from './plaid-link-launcher';

export const metadata: Metadata = {
  title: 'Vincular banco · Asistente Financiero',
  robots: { index: false, follow: false },
};

/** Destino por defecto cuando `redirect_uri` falta o no está permitido. */
const DEFAULT_REDIRECT = '/bancos';

/** Destino nativo que la app Android usa al volver del widget. */
const DEEP_LINK_REDIRECT = 'mybusiness://banking/return';

interface LinkPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Toma el primer valor escalar de un parámetro de consulta. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

/**
 * Allowlist de destinos de vuelta.
 *
 * Sólo rutas internas de bancos y el deep link nativo. Cualquier otro valor
 * (incluidos `//host` y URLs absolutas) cae al destino por defecto para evitar
 * redirecciones abiertas. El deep link no se navega en web: vuelve a `/bancos`.
 */
function resolveReturnTo(rawRedirect: string | undefined): string {
  if (rawRedirect === undefined) {
    return DEFAULT_REDIRECT;
  }

  if (rawRedirect === DEEP_LINK_REDIRECT) {
    return DEFAULT_REDIRECT;
  }

  if (rawRedirect.startsWith('/bancos') && !rawRedirect.startsWith('//')) {
    return rawRedirect;
  }

  return DEFAULT_REDIRECT;
}

export default async function BankingLinkPage({ searchParams }: LinkPageProps) {
  const params = await searchParams;
  const token = firstValue(params.token)?.trim() ?? '';
  const returnTo = resolveReturnTo(firstValue(params.redirect_uri));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-text">Vinculando tu banco</h1>
        <p className="text-base text-text-muted">
          Abriremos la ventana segura de Plaid para que autorices la conexión. Nosotros nunca vemos
          tus credenciales bancarias.
        </p>
      </header>

      <Card className="flex flex-col gap-4">
        <PlaidLinkLauncher token={token} returnTo={returnTo} />
      </Card>

      <p className="text-sm text-text-muted">
        ¿Prefieres hacerlo más tarde? Puedes volver a la{' '}
        <a href="/bancos" className="font-medium text-primary underline-offset-2 hover:underline">
          página de bancos
        </a>{' '}
        cuando quieras.
      </p>
    </main>
  );
}

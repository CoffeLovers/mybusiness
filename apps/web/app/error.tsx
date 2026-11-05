'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    /* Solo el mensaje: nunca el objeto de error ni datos del usuario. */
    console.error(error.message);
  }, [error.message]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-text">Algo salió mal</h1>
      <p className="max-w-md text-base text-text-muted">
        No pudimos cargar esta sección. Intenta de nuevo; si el problema continúa, vuelve más tarde.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-base font-medium text-on-primary"
      >
        Reintentar
      </button>
    </main>
  );
}

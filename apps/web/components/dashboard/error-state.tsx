'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface ErrorStateProps {
  message?: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRetry = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center rounded-xl border border-expense/30 bg-surface-raised p-10 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-expense/10 text-expense">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-7 w-7"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <h2 className="mt-4 text-lg font-semibold text-text">Error al cargar el resumen</h2>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        {message ??
          'Ocurrió un problema de comunicación con el servicio de finanzas. Por favor verifica tu conexión y vuelve a intentarlo.'}
      </p>

      <div className="mt-5">
        <button
          type="button"
          onClick={handleRetry}
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
        >
          {isPending ? 'Reintentando…' : 'Reintentar'}
        </button>
      </div>
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { InlineBanner } from '@/components/ui/inline-banner';

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
    <InlineBanner
      tone="danger"
      titleAs="h2"
      title="Error al cargar el resumen"
      className="items-center gap-2 rounded-xl p-8 text-center"
    >
      <p className="max-w-md text-sm text-text-muted">
        {message ??
          'Ocurrió un problema de comunicación con el servicio de finanzas. Por favor verifica tu conexión y vuelve a intentarlo.'}
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={handleRetry}
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
        >
          {isPending ? 'Reintentando…' : 'Reintentar'}
        </button>
      </div>
    </InlineBanner>
  );
}

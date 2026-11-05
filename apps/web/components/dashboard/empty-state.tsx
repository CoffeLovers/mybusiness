import Link from 'next/link';

interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <section
      aria-label="Estado vacío de finanzas"
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-raised p-12 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-text-muted shadow-xs">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-8 w-8 text-primary"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-semibold text-text">Sin movimientos en el período</h2>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        {message ??
          'No encontramos transacciones ni cuentas activas para el período seleccionado. Vincula una cuenta bancaria o sube tus primeras facturas para comenzar a ver métricas de tesorería.'}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/bancos"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Vincular cuenta bancaria
        </Link>
        <Link
          href="/facturas"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text shadow-xs transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Subir factura
        </Link>
      </div>
    </section>
  );
}

import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-4 py-12 text-center">
      <h1 className="text-4xl font-semibold text-text">404</h1>
      <p className="max-w-md text-base text-text-muted">
        No encontramos la página que buscas. Puede que el enlace esté roto o que la página se haya
        movido.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-contrast"
      >
        Volver al resumen
      </Link>
    </main>
  );
}

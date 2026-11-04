export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-surface-raised" aria-hidden="true" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-surface-raised" aria-hidden="true" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-surface-raised" aria-hidden="true" />
    </div>
  );
}

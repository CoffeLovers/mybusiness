export const metadata = {
  title: 'Resumen · Asistente Financiero',
};

const CARDS = [
  { id: 'ingresos', title: 'Ingresos' },
  { id: 'egresos', title: 'Egresos' },
  { id: 'balance', title: 'Balance' },
] as const;

export default function ResumenPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-text">Resumen</h1>
        <p className="max-w-2xl text-base text-text-muted">
          Aquí verás el estado de tus finanzas de un vistazo. Los datos reales llegarán con SF2-08,
          cuando el portal se conecte a los servicios de finanzas.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <article
            key={card.id}
            className="rounded-lg border border-border bg-surface-raised p-6"
            aria-describedby={`${card.id}-estado`}
          >
            <h2 className="text-sm font-medium text-text-muted">{card.title}</h2>
            <p className="mt-3 text-3xl font-semibold text-text">—</p>
            <p id={`${card.id}-estado`} className="mt-2 text-sm text-text-muted">
              Pendiente de datos
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

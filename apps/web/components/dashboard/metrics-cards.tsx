import { formatMinorUnitsString } from '@/lib/format';
import type { CashflowPreviousPeriod } from '@mybusiness/contracts';

interface MetricsCardsProps {
  balanceMinor: string | null;
  incomeMinor: string | null;
  expenseMinor: string | null;
  burnRateMinor: string | null;
  runwayMonths: number | null;
  previousPeriod: CashflowPreviousPeriod | null;
  currency: string;
}

export function MetricsCards({
  balanceMinor,
  incomeMinor,
  expenseMinor,
  burnRateMinor,
  runwayMonths,
  previousPeriod,
  currency,
}: MetricsCardsProps) {
  const cards = [
    {
      id: 'saldo-consolidado',
      title: 'Saldo consolidado',
      value: balanceMinor !== null ? formatMinorUnitsString(balanceMinor, currency) : '—',
      badge: 'Cuentas activas',
      subtitle: 'Total disponible en tesorería',
      valueColorClass: 'text-text',
    },
    {
      id: 'ingresos',
      title: 'Ingresos',
      value: incomeMinor !== null ? formatMinorUnitsString(incomeMinor, currency) : '—',
      badge: 'Entradas',
      subtitle: previousPeriod
        ? `Período anterior: ${formatMinorUnitsString(previousPeriod.incomeMinor, currency)}`
        : 'Total cobrado en el período',
      valueColorClass: 'text-income',
    },
    {
      id: 'egresos',
      title: 'Egresos',
      value: expenseMinor !== null ? formatMinorUnitsString(expenseMinor, currency) : '—',
      badge: 'Salidas',
      subtitle: previousPeriod
        ? `Período anterior: ${formatMinorUnitsString(previousPeriod.expenseMinor, currency)}`
        : 'Total pagado en el período',
      valueColorClass: 'text-expense',
    },
    {
      id: 'burn-rate',
      title: 'Burn rate mensual',
      value: burnRateMinor !== null ? formatMinorUnitsString(burnRateMinor, currency) : '—',
      badge: 'Gasto mensual promedio',
      subtitle: 'Egresos prorrateados a 30 días',
      valueColorClass: 'text-text',
    },
    {
      id: 'runway',
      title: 'Runway',
      value: runwayMonths !== null ? `${runwayMonths.toFixed(1)} meses` : '—',
      badge: 'Supervivencia estimada',
      subtitle: 'Meses de caja según burn rate',
      valueColorClass: 'text-text',
    },
  ];

  return (
    <section
      aria-label="Métricas clave de flujo de caja"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
    >
      {cards.map((card) => {
        const isFeatured = card.id === 'saldo-consolidado';

        return (
          <article
            key={card.id}
            className={
              isFeatured
                ? 'flex flex-col justify-between rounded-lg border border-accent bg-accent p-5 text-on-accent shadow-sm sm:col-span-2 lg:col-span-1'
                : 'flex flex-col justify-between rounded-lg border border-border bg-surface-raised p-5 shadow-xs transition-shadow hover:shadow-sm'
            }
            aria-describedby={`${card.id}-subtitle`}
          >
            <header className="flex items-center justify-between gap-2">
              <h2
                className={
                  isFeatured
                    ? 'text-sm font-medium text-on-accent'
                    : 'text-sm font-medium text-text-muted'
                }
              >
                {card.title}
              </h2>
              <span
                className={
                  isFeatured
                    ? 'rounded-full bg-inverse px-2 py-0.5 text-[11px] font-semibold text-accent'
                    : 'rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-muted'
                }
              >
                {card.badge}
              </span>
            </header>

            <p
              className={
                isFeatured
                  ? 'mt-3 text-4xl font-light tracking-tight tabular-nums text-on-accent'
                  : `mt-3 text-3xl font-light tracking-tight tabular-nums ${card.valueColorClass}`
              }
            >
              {card.value}
            </p>

            <footer
              id={`${card.id}-subtitle`}
              className={
                isFeatured ? 'mt-2 text-xs text-on-accent/80' : 'mt-2 text-xs text-text-muted'
              }
            >
              {card.subtitle}
            </footer>
          </article>
        );
      })}
    </section>
  );
}

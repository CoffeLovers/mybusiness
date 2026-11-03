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
      {cards.map((card) => (
        <article
          key={card.id}
          className="flex flex-col justify-between rounded-lg border border-border bg-surface-raised p-5 shadow-xs transition-shadow hover:shadow-sm"
          aria-describedby={`${card.id}-subtitle`}
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-text-muted">{card.title}</h2>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-muted">
              {card.badge}
            </span>
          </header>

          <p className={`mt-3 text-2xl font-bold tracking-tight ${card.valueColorClass}`}>
            {card.value}
          </p>

          <footer id={`${card.id}-subtitle`} className="mt-2 text-xs text-text-muted">
            {card.subtitle}
          </footer>
        </article>
      ))}
    </section>
  );
}

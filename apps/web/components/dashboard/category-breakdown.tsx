import { formatMinorUnitsString } from '@/lib/format';
import type { CashflowCategoryBreakdown } from '@mybusiness/contracts';

interface CategoryBreakdownProps {
  categories: CashflowCategoryBreakdown[];
  currency: string;
}

export function CategoryBreakdown({ categories, currency }: CategoryBreakdownProps) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Desglose de gastos por categoría"
      className="rounded-lg border border-border bg-surface p-5 shadow-xs"
    >
      <header className="mb-4">
        <h2 className="text-base font-semibold text-text">Desglose de gastos por categoría</h2>
        <p className="text-xs text-text-muted">Top 10 categorías de mayor impacto en egresos</p>
      </header>

      <ul className="flex flex-col gap-3.5" role="list">
        {categories.map((cat) => {
          // El ancho de la barra horizontal usa el share (0..1) calculado en el servidor
          const widthPercent = Math.min(100, Math.max(3, Math.round(cat.share * 100)));
          const formattedAmount = formatMinorUnitsString(cat.amountMinor, currency);
          const shareFormatted = `${(cat.share * 100).toFixed(1)}%`;

          return (
            <li key={cat.category} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-text">{cat.category}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">{shareFormatted}</span>
                  <span className="font-semibold text-text">{formattedAmount}</span>
                </div>
              </div>

              {/* Barra horizontal con ancho proporcional al share del servidor */}
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
                role="progressbar"
                aria-valuenow={Math.round(cat.share * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${cat.category}: ${shareFormatted}`}
              >
                <div
                  className="h-full rounded-full bg-expense transition-all duration-300"
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

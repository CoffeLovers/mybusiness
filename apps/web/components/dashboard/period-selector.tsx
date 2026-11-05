'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { getPresetDates, type PeriodPreset } from '@/lib/date-utils';

interface PeriodSelectorProps {
  currentFrom: string;
  currentTo: string;
  currentCurrency: string;
  availableCurrencies: string[];
}

const PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: '30d', label: 'Últimos 30 días' },
  { id: '90d', label: 'Últimos 90 días' },
  { id: 'ytd', label: 'Año actual' },
];

export function PeriodSelector({
  currentFrom,
  currentTo,
  currentCurrency,
  availableCurrencies,
}: PeriodSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handlePresetChange = (preset: PeriodPreset) => {
    const dates = getPresetDates(preset);
    const params = new URLSearchParams(searchParams.toString());
    params.set('from', dates.from);
    params.set('to', dates.to);
    if (currentCurrency) {
      params.set('currency', currentCurrency);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleCurrencyChange = (currency: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('currency', currency);
    if (currentFrom) params.set('from', currentFrom);
    if (currentTo) params.set('to', currentTo);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Determinar cuál preset está activo
  const activePreset =
    PRESETS.find((p) => {
      const dates = getPresetDates(p.id);
      return dates.from === currentFrom && dates.to === currentTo;
    })?.id ?? null;

  return (
    <div
      role="toolbar"
      data-hydrated={hydrated}
      aria-label="Filtro de período y moneda"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-3"
    >
      <div
        role="group"
        aria-label="Selector de período"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Período:
        </span>
        {PRESETS.map((preset) => {
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePresetChange(preset.id)}
              disabled={isPending}
              aria-pressed={isActive}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                isActive
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-raised text-text hover:bg-border/40'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {availableCurrencies.length > 1 && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="cashflow-currency-select"
            className="text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Moneda:
          </label>
          <select
            id="cashflow-currency-select"
            value={currentCurrency}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            disabled={isPending}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Región aria-live para notificar cambios de período a lectores de pantalla */}
      <div aria-live="polite" className="sr-only">
        {isPending
          ? 'Actualizando resumen de flujo de caja…'
          : `Período seleccionado: ${
              activePreset
                ? PRESETS.find((p) => p.id === activePreset)?.label
                : `${currentFrom} a ${currentTo}`
            }, divisa ${currentCurrency}`}
      </div>
    </div>
  );
}

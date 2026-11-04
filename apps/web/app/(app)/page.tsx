import type { CashflowSummaryResponse } from '@mybusiness/contracts';
import { CashflowChart } from '@/components/dashboard/cashflow-chart';
import { CategoryBreakdown } from '@/components/dashboard/category-breakdown';
import { EmptyState } from '@/components/dashboard/empty-state';
import { ErrorState } from '@/components/dashboard/error-state';
import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { getPresetDates } from '@/lib/date-utils';
import { gatewayFetch } from '@/lib/server/gateway-client';
import { readSession } from '@/lib/session/server';

export const metadata = {
  title: 'Resumen · Asistente Financiero',
};

interface PageProps {
  searchParams?: Promise<{
    from?: string;
    to?: string;
    currency?: string;
  }>;
}

export default async function ResumenPage(props: PageProps) {
  const session = await readSession();
  const firstName = session?.user.firstName ?? 'usuario';
  const resolvedSearchParams = (await props.searchParams) ?? {};

  const defaultDates = getPresetDates('30d');
  const from = resolvedSearchParams.from || defaultDates.from;
  const to = resolvedSearchParams.to || defaultDates.to;
  const currencyParam = resolvedSearchParams.currency;

  let summary: CashflowSummaryResponse | null = null;
  let errorMessage: string | null = null;

  if (session?.accessToken) {
    try {
      const query = new URLSearchParams({
        from,
        to,
        compare: 'true',
      });
      if (currencyParam) {
        query.set('currency', currencyParam);
      }

      summary = await gatewayFetch<CashflowSummaryResponse>(
        `/api/v1/finance/cashflow/summary?${query.toString()}`,
        { accessToken: session.accessToken },
      );
    } catch (err) {
      errorMessage =
        err instanceof Error ? err.message : 'No se pudo conectar al servicio financiero.';
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold text-text">Resumen</h1>
        <p className="text-base text-text-muted">Hola, {firstName}. Bienvenido de nuevo.</p>
      </header>

      {errorMessage !== null ? (
        <ErrorState message={errorMessage} />
      ) : summary === null || !summary.hasData ? (
        <div className="flex flex-col gap-6">
          <PeriodSelector
            currentFrom={from}
            currentTo={to}
            currentCurrency={summary?.currency ?? currencyParam ?? 'COP'}
            availableCurrencies={summary?.availableCurrencies ?? []}
          />
          <EmptyState />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <PeriodSelector
            currentFrom={from}
            currentTo={to}
            currentCurrency={summary.currency}
            availableCurrencies={summary.availableCurrencies}
          />

          <MetricsCards
            balanceMinor={summary.balanceMinor}
            incomeMinor={summary.incomeMinor}
            expenseMinor={summary.expenseMinor}
            burnRateMinor={summary.burnRateMinor}
            runwayMonths={summary.runwayMonths}
            previousPeriod={summary.previousPeriod}
            currency={summary.currency}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={summary.categories.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CashflowChart series={summary.series} currency={summary.currency} />
            </div>
            {summary.categories.length > 0 && (
              <div className="lg:col-span-1">
                <CategoryBreakdown categories={summary.categories} currency={summary.currency} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

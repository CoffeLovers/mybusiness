'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { CashflowBucket } from '@mybusiness/contracts';
import { formatBucketLabel } from '@/lib/date-utils';
import { formatMinorUnitsString } from '@/lib/format';

// Dynamic import para evitar problemas de SSR con canvas / window en Next.js
const ReactECharts = dynamic(() => import('echarts-for-react'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Cargando gráfico de flujo de caja"
      className="flex h-80 w-full items-center justify-center rounded-lg bg-surface-raised"
    >
      <span className="text-sm text-text-muted">Cargando gráfico…</span>
    </div>
  ),
});

interface CashflowChartProps {
  series: CashflowBucket[];
  currency: string;
}

export function CashflowChart({ series, currency }: CashflowChartProps) {
  const firstBucket = series[0];
  const isMonthly = Boolean(
    firstBucket && firstBucket.bucketStart.endsWith('-01') && series.length <= 12,
  );

  const option = useMemo(() => {
    const xLabels = series.map((b) => formatBucketLabel(b.bucketStart, isMonthly));
    // ECharts grafica sobre valores numéricos en unidades mayores
    const incomeData = series.map((b) => Number(BigInt(b.incomeMinor)) / 100);
    const expenseData = series.map((b) => Number(BigInt(b.expenseMinor)) / 100);

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number }>) => {
          if (!params || params.length === 0) return '';
          const first = params[0];
          if (!first) return '';
          const title = first.axisValue;
          const rows = params.map((p) => {
            const rawMinor = Math.round(p.value * 100).toString();
            const formatted = formatMinorUnitsString(rawMinor, currency);
            const colorDot =
              p.seriesName === 'Ingresos'
                ? '<span style="color:#047857;font-size:16px;">●</span>'
                : '<span style="color:#b91c1c;font-size:16px;">●</span>';
            return `<div style="display:flex;justify-content:space-between;gap:12px;">
              <span>${colorDot} ${p.seriesName}:</span>
              <strong>${formatted}</strong>
            </div>`;
          });
          return `<div style="font-family:sans-serif;padding:4px 6px;">
            <div style="font-weight:600;margin-bottom:4px;">${title}</div>
            ${rows.join('')}
          </div>`;
        },
      },
      legend: {
        top: 0,
        right: 10,
        data: ['Ingresos', 'Egresos'],
        textStyle: { color: 'var(--color-text, #101720)' },
      },
      grid: {
        top: 40,
        right: 20,
        bottom: 30,
        left: 60,
        containLabel: false,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: 'var(--color-border, #c3ccd6)' } },
        axisLabel: {
          color: 'var(--color-text-muted, #55606f)',
          fontSize: 11,
          interval: series.length > 31 ? 'auto' : 0,
          rotate: series.length > 20 ? 45 : 0,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'var(--color-border, #c3ccd6)', opacity: 0.3 } },
        axisLabel: {
          color: 'var(--color-text-muted, #55606f)',
          fontSize: 11,
          formatter: (value: number) => {
            if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
            if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
            return `${value}`;
          },
        },
      },
      series: [
        {
          name: 'Ingresos',
          type: 'bar',
          data: incomeData,
          itemStyle: { color: '#047857', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 24,
        },
        {
          name: 'Egresos',
          type: 'bar',
          data: expenseData,
          itemStyle: { color: '#b91c1c', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 24,
        },
      ],
    };
  }, [series, isMonthly, currency]);

  if (series.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Gráfico de ingresos y egresos en el tiempo"
      className="rounded-lg border border-border bg-surface p-5 shadow-xs"
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Evolución de flujo de caja</h2>
          <p className="text-xs text-text-muted">
            {isMonthly ? 'Agrupado por mes' : 'Agrupado por día'} ({currency})
          </p>
        </div>
      </header>

      <div className="h-80 w-full" aria-hidden="true">
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'svg' }}
          notMerge={true}
        />
      </div>

      {/* Tabla accesible para lectores de pantalla */}
      <div className="sr-only">
        <table>
          <caption>Flujo de caja por período</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">Ingresos</th>
              <th scope="col">Egresos</th>
            </tr>
          </thead>
          <tbody>
            {series.map((bucket) => (
              <tr key={bucket.bucketStart}>
                <td>{bucket.bucketStart}</td>
                <td>{formatMinorUnitsString(bucket.incomeMinor, currency)}</td>
                <td>{formatMinorUnitsString(bucket.expenseMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

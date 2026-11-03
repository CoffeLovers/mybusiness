import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type {
  CashflowBucket,
  CashflowCategoryBreakdown,
  CashflowPreviousPeriod,
  CashflowSummaryResponse,
  CashflowSummaryRpcPayload,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import { bankAccounts, bankTransactions } from '../database/schema';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

@Injectable()
export class CashflowService {
  private readonly logger = new Logger(CashflowService.name);

  constructor(private readonly databaseService: FinanceDatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  /**
   * Genera el resumen consolidado de flujo de caja, burn rate, runway,
   * desglose por categorías y serie temporal para un tenant en un período.
   */
  async getCashflowSummary(payload: CashflowSummaryRpcPayload): Promise<CashflowSummaryResponse> {
    const { tenantId, from, to, currency, compare = true } = payload;

    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }

    this.validateDates(from, to);

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const rangeDays = Math.round(diffMs / 86400000) + 1;

    // 1. Obtener cuentas bancarias del tenant no eliminadas
    const accounts = await this.db
      .select({
        id: bankAccounts.id,
        currency: bankAccounts.currency,
        currentBalanceMinor: bankAccounts.currentBalanceMinor,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.tenantId, tenantId), isNull(bankAccounts.deletedAt)));

    if (accounts.length === 0) {
      return this.emptyResponse(from, to, currency?.toUpperCase() ?? 'COP', []);
    }

    const availableCurrencies = [...new Set(accounts.map((a) => a.currency))].sort();
    const activeCurrency = currency ? currency.toUpperCase() : availableCurrencies[0];

    const matchingAccounts = accounts.filter((a) => a.currency === activeCurrency);
    if (matchingAccounts.length === 0) {
      return this.emptyResponse(from, to, activeCurrency, availableCurrencies);
    }

    const matchingAccountIds = matchingAccounts.map((a) => a.id);

    // Saldo consolidado = suma de current_balance_minor de las cuentas en la moneda activa
    const balanceMinorBigInt = matchingAccounts.reduce(
      (acc, a) => acc + BigInt(a.currentBalanceMinor ?? 0n),
      0n,
    );

    // 2. Movimientos bancarios del tenant en el rango de fechas
    const txRows = await this.db
      .select({
        id: bankTransactions.id,
        amountMinor: bankTransactions.amountMinor,
        transactionType: bankTransactions.transactionType,
        date: bankTransactions.date,
        category: bankTransactions.category,
      })
      .from(bankTransactions)
      .where(
        and(
          inArray(bankTransactions.accountId, matchingAccountIds),
          isNull(bankTransactions.removedAt),
          gte(bankTransactions.date, from),
          lte(bankTransactions.date, to),
        ),
      );

    // Si no hay movimientos en el período, devuelve hasData=false con métricas null
    if (txRows.length === 0) {
      return this.emptyResponse(from, to, activeCurrency, availableCurrencies);
    }

    // 3. Totales de ingresos y egresos (las transferencias se ignoran)
    let totalIncomeMinor = 0n;
    let totalExpenseMinor = 0n;

    for (const tx of txRows) {
      const rawAmt = BigInt(tx.amountMinor);
      const absAmt = rawAmt < 0n ? -rawAmt : rawAmt;
      if (tx.transactionType === 'INCOME') {
        totalIncomeMinor += absAmt;
      } else if (tx.transactionType === 'EXPENSE') {
        totalExpenseMinor += absAmt;
      }
    }

    // 4. Burn rate = egresos / meses del período (half-up rounding a unidad menor)
    let burnRateMinor: string | null = null;
    let runwayMonths: number | null = null;

    if (totalExpenseMinor > 0n) {
      // Meses = rangeDays / 30. Burn rate = (totalExpenseMinor * 30) / rangeDays
      // Redondeo half-up con BigInt: (num * 2 + den) / (den * 2)
      const num = totalExpenseMinor * 30n;
      const den = BigInt(rangeDays);
      const burnRateBigInt = (num * 2n + den) / (den * 2n);
      burnRateMinor = burnRateBigInt.toString();

      // Runway = saldo / burnRate en meses con un decimal
      if (burnRateBigInt > 0n) {
        if (balanceMinorBigInt <= 0n) {
          runwayMonths = 0;
        } else {
          // Un decimal: Math.round((balance / burnRate) * 10) / 10
          runwayMonths = Math.round(Number((balanceMinorBigInt * 10n) / burnRateBigInt)) / 10;
        }
      }
    }

    // 5. Buckets de la serie temporal (diarios si <= 90 días, mensuales si mayor)
    const series = this.buildSeries(txRows, from, to, fromDate, toDate, rangeDays);

    // 6. Top 10 categorías de egresos con share 0..1 calculado en servidor
    const categories = this.buildCategories(txRows, totalExpenseMinor);

    // 7. Comparación con período anterior si compare !== false
    let previousPeriod: CashflowPreviousPeriod | null = null;
    if (compare) {
      previousPeriod = await this.getPreviousPeriodTotals(matchingAccountIds, fromDate, rangeDays);
    }

    return {
      hasData: true,
      currency: activeCurrency,
      availableCurrencies,
      period: { from, to },
      balanceMinor: balanceMinorBigInt.toString(),
      incomeMinor: totalIncomeMinor.toString(),
      expenseMinor: totalExpenseMinor.toString(),
      burnRateMinor,
      runwayMonths,
      previousPeriod,
      series,
      categories,
    };
  }

  private validateDates(from: string, to: string): void {
    if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
      throw new BadRequestException('Las fechas deben tener el formato YYYY-MM-DD.');
    }

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);

    if (
      isNaN(fromDate.getTime()) ||
      isNaN(toDate.getTime()) ||
      fromDate.toISOString().slice(0, 10) !== from ||
      toDate.toISOString().slice(0, 10) !== to
    ) {
      throw new BadRequestException('Fecha inválida.');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('La fecha inicial no puede ser posterior a la fecha final.');
    }

    const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    if (diffDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`El rango no puede exceder ${MAX_RANGE_DAYS} días.`);
    }
  }

  private emptyResponse(
    from: string,
    to: string,
    currency: string,
    availableCurrencies: string[],
  ): CashflowSummaryResponse {
    return {
      hasData: false,
      currency,
      availableCurrencies,
      period: { from, to },
      balanceMinor: null,
      incomeMinor: null,
      expenseMinor: null,
      burnRateMinor: null,
      runwayMonths: null,
      previousPeriod: null,
      series: [],
      categories: [],
    };
  }

  private buildSeries(
    txRows: Array<{
      amountMinor: bigint | number | string;
      transactionType: string;
      date: string;
    }>,
    from: string,
    to: string,
    fromDate: Date,
    toDate: Date,
    rangeDays: number,
  ): CashflowBucket[] {
    const isDaily = rangeDays <= 90;
    const bucketMap = new Map<string, { income: bigint; expense: bigint }>();

    if (isDaily) {
      const current = new Date(fromDate);
      while (current <= toDate) {
        const key = current.toISOString().slice(0, 10);
        bucketMap.set(key, { income: 0n, expense: 0n });
        current.setUTCDate(current.getUTCDate() + 1);
      }

      for (const tx of txRows) {
        const bucket = bucketMap.get(tx.date);
        if (bucket) {
          const rawAmt = BigInt(tx.amountMinor);
          const absAmt = rawAmt < 0n ? -rawAmt : rawAmt;
          if (tx.transactionType === 'INCOME') bucket.income += absAmt;
          if (tx.transactionType === 'EXPENSE') bucket.expense += absAmt;
        }
      }
    } else {
      // Buckets mensuales
      const startYear = fromDate.getUTCFullYear();
      const startMonth = fromDate.getUTCMonth();
      const endYear = toDate.getUTCFullYear();
      const endMonth = toDate.getUTCMonth();

      let y = startYear;
      let m = startMonth;

      while (y < endYear || (y === endYear && m <= endMonth)) {
        const monthStr = String(m + 1).padStart(2, '0');
        const key = `${y}-${monthStr}-01`;
        bucketMap.set(key, { income: 0n, expense: 0n });
        m++;
        if (m > 11) {
          m = 0;
          y++;
        }
      }

      for (const tx of txRows) {
        const monthKey = `${tx.date.slice(0, 7)}-01`;
        const bucket = bucketMap.get(monthKey);
        if (bucket) {
          const rawAmt = BigInt(tx.amountMinor);
          const absAmt = rawAmt < 0n ? -rawAmt : rawAmt;
          if (tx.transactionType === 'INCOME') bucket.income += absAmt;
          if (tx.transactionType === 'EXPENSE') bucket.expense += absAmt;
        }
      }
    }

    return Array.from(bucketMap.entries()).map(([bucketStart, totals]) => ({
      bucketStart,
      incomeMinor: totals.income.toString(),
      expenseMinor: totals.expense.toString(),
    }));
  }

  private buildCategories(
    txRows: Array<{
      amountMinor: bigint | number | string;
      transactionType: string;
      category: string[] | null;
    }>,
    totalExpenseMinor: bigint,
  ): CashflowCategoryBreakdown[] {
    const categoryTotals = new Map<string, bigint>();

    for (const tx of txRows) {
      if (tx.transactionType !== 'EXPENSE') continue;

      let categoryName = 'Sin categoría';
      if (
        Array.isArray(tx.category) &&
        tx.category.length > 0 &&
        typeof tx.category[0] === 'string' &&
        tx.category[0].trim().length > 0
      ) {
        categoryName = tx.category[0].trim();
      }

      const rawAmt = BigInt(tx.amountMinor);
      const absAmt = rawAmt < 0n ? -rawAmt : rawAmt;
      categoryTotals.set(categoryName, (categoryTotals.get(categoryName) ?? 0n) + absAmt);
    }

    const sorted = Array.from(categoryTotals.entries())
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, 10);

    return sorted.map(([category, amount]) => {
      let share = 0;
      if (totalExpenseMinor > 0n) {
        share = Math.round((Number(amount) / Number(totalExpenseMinor)) * 10000) / 10000;
      }
      return {
        category,
        amountMinor: amount.toString(),
        share,
      };
    });
  }

  private async getPreviousPeriodTotals(
    matchingAccountIds: string[],
    fromDate: Date,
    rangeDays: number,
  ): Promise<CashflowPreviousPeriod> {
    const prevToDate = new Date(fromDate.getTime() - 86400000);
    const prevFromDate = new Date(prevToDate.getTime() - (rangeDays - 1) * 86400000);

    const prevFrom = prevFromDate.toISOString().slice(0, 10);
    const prevTo = prevToDate.toISOString().slice(0, 10);

    const prevRows = await this.db
      .select({
        amountMinor: bankTransactions.amountMinor,
        transactionType: bankTransactions.transactionType,
      })
      .from(bankTransactions)
      .where(
        and(
          inArray(bankTransactions.accountId, matchingAccountIds),
          isNull(bankTransactions.removedAt),
          gte(bankTransactions.date, prevFrom),
          lte(bankTransactions.date, prevTo),
        ),
      );

    let prevIncome = 0n;
    let prevExpense = 0n;

    for (const tx of prevRows) {
      const rawAmt = BigInt(tx.amountMinor);
      const absAmt = rawAmt < 0n ? -rawAmt : rawAmt;
      if (tx.transactionType === 'INCOME') prevIncome += absAmt;
      if (tx.transactionType === 'EXPENSE') prevExpense += absAmt;
    }

    return {
      incomeMinor: prevIncome.toString(),
      expenseMinor: prevExpense.toString(),
    };
  }
}

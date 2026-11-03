import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { CURRENCY_CODE_PATTERN } from '../money';
import type { WithContext } from './context.dto';

export interface CashflowSummaryQuery {
  from: string;
  to: string;
  currency?: string;
  compare?: boolean;
}

export class CashflowSummaryQueryDto implements CashflowSummaryQuery {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from debe tener formato YYYY-MM-DD',
  })
  from!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to debe tener formato YYYY-MM-DD',
  })
  to!: string;

  @IsString()
  @IsOptional()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'currency debe ser un código ISO 4217 de 3 letras',
  })
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    return Boolean(value);
  })
  @IsBoolean()
  compare?: boolean;
}

export interface CashflowBucket {
  bucketStart: string;
  incomeMinor: string;
  expenseMinor: string;
}

export interface CashflowCategoryBreakdown {
  category: string;
  amountMinor: string;
  share: number;
}

export interface CashflowPreviousPeriod {
  incomeMinor: string;
  expenseMinor: string;
}

export interface CashflowSummaryResponse {
  hasData: boolean;
  currency: string;
  availableCurrencies: string[];
  period: { from: string; to: string };
  balanceMinor: string | null;
  incomeMinor: string | null;
  expenseMinor: string | null;
  burnRateMinor: string | null;
  runwayMonths: number | null;
  previousPeriod: CashflowPreviousPeriod | null;
  series: CashflowBucket[];
  categories: CashflowCategoryBreakdown[];
}

export type CashflowSummaryRpcPayload = WithContext<CashflowSummaryQuery>;

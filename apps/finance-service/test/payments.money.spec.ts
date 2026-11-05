import { describe, expect, it } from 'vitest';
import { currencyScaleOf, minorToPayPalDecimal, MoneyFormatError } from '@mybusiness/contracts';

describe('minorToPayPalDecimal (contrato monetario -> proveedor)', () => {
  it('convierte enteros en unidad mínima a decimal de 2 escalar (USD)', () => {
    expect(minorToPayPalDecimal('1234', 'USD')).toBe('12.34');
    expect(minorToPayPalDecimal('5', 'USD')).toBe('0.05');
    expect(minorToPayPalDecimal('0', 'USD')).toBe('0.00');
  });

  it('respeta monedas sin decimales (JPY)', () => {
    expect(currencyScaleOf('JPY')).toBe(0);
    expect(minorToPayPalDecimal('1234', 'JPY')).toBe('1234');
  });

  it('respeta monedas de 3 decimales (KWD)', () => {
    expect(minorToPayPalDecimal('1234', 'KWD')).toBe('1.234');
  });

  it('no pierde precisión por encima de Number.MAX_SAFE_INTEGER (ADR 003)', () => {
    const beyondSafe = '90071992547409931';
    expect(minorToPayPalDecimal(beyondSafe, 'USD')).toBe('900719925474099.31');
  });

  it('redondeo por truncamiento exacto sin aritmética flotante', () => {
    expect(minorToPayPalDecimal('999999999999999999', 'USD')).toBe('9999999999999999.99');
  });

  it('rechaza decimales y strings no enteros', () => {
    expect(() => minorToPayPalDecimal('12.5', 'USD')).toThrow(MoneyFormatError);
    expect(() => minorToPayPalDecimal('1e3', 'USD')).toThrow(MoneyFormatError);
    expect(() => minorToPayPalDecimal('-100', 'USD')).toThrow(MoneyFormatError);
    expect(() => minorToPayPalDecimal('abc', 'USD')).toThrow(MoneyFormatError);
  });

  it('rechaza monedas inválidas', () => {
    expect(() => minorToPayPalDecimal('1000', 'usd')).toThrow(MoneyFormatError);
    expect(() => minorToPayPalDecimal('1000', 'USDT')).toThrow(MoneyFormatError);
    expect(() => minorToPayPalDecimal('1000', '')).toThrow(MoneyFormatError);
  });
});

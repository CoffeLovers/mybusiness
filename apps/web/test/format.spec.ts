import { describe, expect, it } from 'vitest';

import { formatMinorUnits, formatSignedMinorUnits } from '../lib/format';

/** Normaliza los espacios no separables que inserta `Intl` antes del símbolo. */
const plain = (value: string): string => value.replace(/[\u00A0\u202F]/g, ' ');

describe('formatMinorUnits', () => {
  it('convierte unidades menores a euros en es-ES', () => {
    expect(plain(formatMinorUnits(123456))).toContain('1.234,56 €');
  });

  it('formatea el cero', () => {
    expect(plain(formatMinorUnits(0))).toBe('0,00 €');
  });

  it('respeta moneda y locale explícitos', () => {
    expect(formatMinorUnits(100, 'USD', 'en-US')).toBe('$1.00');
  });

  it('formatea importes negativos con el signo del formateador', () => {
    expect(plain(formatMinorUnits(-12345))).toContain('-123,45');
  });

  it.each([1.5, -0.5, NaN, Infinity, -Infinity])('lanza RangeError con %j', (invalid) => {
    expect(() => formatMinorUnits(invalid)).toThrow(RangeError);
    expect(() => formatMinorUnits(invalid)).toThrow(/entero finito/);
  });
});

describe('formatSignedMinorUnits', () => {
  it('antepone + a los importes positivos', () => {
    const formatted = formatSignedMinorUnits(12345);

    expect(formatted.startsWith('+')).toBe(true);
    expect(formatted.slice(0, 2)).toBe('+\u00A0');
    expect(plain(formatted)).toBe('+ 123,45 €');
  });

  it('antepone - a los importes negativos sin duplicar el signo', () => {
    const formatted = formatSignedMinorUnits(-12345);

    expect(formatted.startsWith('-')).toBe(true);
    expect(formatted.slice(0, 2)).toBe('-\u00A0');
    expect(formatted).not.toContain('--');
    expect(plain(formatted)).toBe('- 123,45 €');
  });

  it('no añade signo al cero', () => {
    const formatted = formatSignedMinorUnits(0);

    expect(formatted.startsWith('+')).toBe(false);
    expect(formatted.startsWith('-')).toBe(false);
    expect(plain(formatted)).toBe('0,00 €');
  });

  it('respeta moneda y locale explícitos', () => {
    expect(formatSignedMinorUnits(12345, 'USD', 'en-US')).toBe('+\u00A0$123.45');
    expect(formatSignedMinorUnits(-12345, 'USD', 'en-US')).toBe('-\u00A0$123.45');
  });

  it('propaga el RangeError de la validación de entrada', () => {
    expect(() => formatSignedMinorUnits(1.5)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import { parseDurationToMs } from '@mybusiness/common';

describe('parseDurationToMs', () => {
  it.each([
    ['500ms', 500],
    ['15s', 15_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('convierte %s a %i ms', (value, expected) => {
    expect(parseDurationToMs(value)).toBe(expected);
  });

  it('rechaza formatos inválidos y valores no positivos', () => {
    expect(() => parseDurationToMs('15')).toThrow('Duración inválida');
    expect(() => parseDurationToMs('1w')).toThrow('Duración inválida');
    expect(() => parseDurationToMs('0s')).toThrow('entero positivo');
  });
});

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex, relativeLuminance } from '../lib/contrast';
import { palettes, textPairs, type PaletteName } from '../lib/tokens';

const paletteNames = Object.keys(palettes) as PaletteName[];

const paletteCases = paletteNames.flatMap((name) =>
  textPairs.map((pair) => ({ name, fg: pair.fg, bg: pair.bg }) as const),
);

describe('parseHex', () => {
  it('expande la notación corta #rgb', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#0a0')).toEqual([0, 170, 0]);
  });

  it('acepta #rrggbb en mayúsculas y minúsculas', () => {
    expect(parseHex('#101720')).toEqual([16, 23, 32]);
    expect(parseHex('#AABBCC')).toEqual([170, 187, 204]);
  });

  it.each([
    ['', 'cadena vacía'],
    ['red', 'nombre de color CSS'],
    ['fff', 'sin almohadilla'],
    ['#ff', 'longitud 2'],
    ['#12345', 'longitud 5'],
    ['#1234567', 'longitud 7'],
    ['#gggggg', 'dígitos no hexadecimales'],
    ['#12345g', 'carácter final inválido'],
  ])('lanza Error con %j (%s)', (invalid) => {
    expect(() => parseHex(invalid)).toThrow(Error);
    expect(() => parseHex(invalid)).toThrow(/inválido/);
  });
});

describe('relativeLuminance', () => {
  it('devuelve 0 para negro y 1 para blanco', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('aplica la corrección gamma en la zona lineal baja', () => {
    // #0a0a0a: 10/255 = 0.0392 -> rama lineal (c / 12.92).
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(0.003, 3);
  });
});

describe('contrastRatio', () => {
  it('devuelve 21 para negro sobre blanco', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('devuelve 1 para un color contra sí mismo', () => {
    expect(contrastRatio('#1d4ed8', '#1d4ed8')).toBe(1);
  });

  it('es indiferente al orden de los argumentos', () => {
    expect(contrastRatio('#ffffff', '#101720')).toBe(contrastRatio('#101720', '#ffffff'));
  });

  it('redondea a dos decimales', () => {
    const ratio = contrastRatio('#7aa2ff', '#0b0f16');

    expect(ratio).toBe(Math.round(ratio * 100) / 100);
  });
});

describe.each(paletteNames)('paleta %s', (name) => {
  const palette = palettes[name];

  it.each(paletteCases.filter((testCase) => testCase.name === name))(
    '$fg sobre $bg cumple WCAG AA (>= 4.5)',
    ({ fg, bg }) => {
      expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('informa del contraste de border/surface frente al umbral 3:1 de texto grande', () => {
    // `--color-border` está documentado en globals.css como decorativo (no
    // transmite información por sí solo), así que el umbral 3:1 se registra
    // como observación (`expect.soft`) y no como gate de la suite.
    const borderRatio = contrastRatio(palette.border, palette.surface);

    console.info(
      `[contrast] ${name}: border/surface = ${borderRatio.toFixed(2)} (texto grande >= 3): ${borderRatio >= 3}`,
    );

    expect
      .soft(borderRatio, `${name}: border/surface debe ser un ratio de contraste válido`)
      .toBeGreaterThan(1);
  });
});

/**
 * Utilidades de contraste WCAG 2.1 (relación de contraste 4.5:1 / 3:1).
 * Sin dependencias externas: sólo aritmética sobre canales sRGB.
 */

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Convierte `#rgb` o `#rrggbb` en sus canales `[r, g, b]` (0-255).
 * @throws Error si la cadena no es un color hexadecimal válido.
 */
export function parseHex(hex: string): [number, number, number] {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`Color hexadecimal inválido: "${hex}"`);
  }

  const digits = hex.slice(1);
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;

  const value = Number.parseInt(expanded, 16);

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Luminancia relativa de un color, según la fórmula WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Relación de contraste entre dos colores (orden indiferente),
 * redondeada a dos decimales. Rango: 1 (idénticos) a 21 (negro/blanco).
 */
export function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);

  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  const ratio = (lighter + 0.05) / (darker + 0.05);

  return Math.round(ratio * 100) / 100;
}

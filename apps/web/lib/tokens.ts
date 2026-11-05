/**
 * Tokens de color de `app/globals.css` en formato TypeScript.
 *
 * Fuente de verdad: los bloques `:root` (tema claro) y `:root.dark` (tema
 * oscuro) de `apps/web/app/globals.css`. Cualquier cambio de color debe
 * replicarse en ambos sitios; `test/contrast.spec.ts` verifica el contraste
 * WCAG AA de los pares de texto declarados en `textPairs`.
 */
export const palettes = {
  light: {
    surface: '#ffffff',
    surfaceRaised: '#f4f6f8',
    border: '#c3ccd6',
    borderStrong: '#6b7280',
    text: '#101720',
    textMuted: '#55606f',
    primary: '#1d4ed8',
    onPrimary: '#ffffff',
    focusRing: '#1d4ed8',
    income: '#047857',
    expense: '#b91c1c',
    neutral: '#4b5563',
    alert: '#92400e',
  },
  dark: {
    surface: '#0b0f16',
    surfaceRaised: '#151b24',
    border: '#3f4b5c',
    borderStrong: '#7c8ba1',
    text: '#f2f5f8',
    textMuted: '#a3aebd',
    primary: '#7aa2ff',
    onPrimary: '#0b0f16',
    focusRing: '#7aa2ff',
    income: '#34d399',
    expense: '#f87171',
    neutral: '#9aa5b4',
    alert: '#fbbf24',
  },
} as const;

export type PaletteName = keyof typeof palettes;

export type PaletteToken = keyof (typeof palettes)[PaletteName];

/**
 * Pares texto/fondo que la interfaz usa realmente y que, por tanto, deben
 * superar 4.5:1 (AA para texto normal).
 */
export const textPairs = [
  { fg: 'text', bg: 'surface' },
  { fg: 'text', bg: 'surfaceRaised' },
  { fg: 'textMuted', bg: 'surface' },
  { fg: 'textMuted', bg: 'surfaceRaised' },
  { fg: 'onPrimary', bg: 'primary' },
  { fg: 'income', bg: 'surfaceRaised' },
  { fg: 'expense', bg: 'surfaceRaised' },
  { fg: 'alert', bg: 'surfaceRaised' },
] as const;

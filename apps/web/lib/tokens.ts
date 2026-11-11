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
    surfaceRaised: '#f4f3fe',
    border: '#e5e3fc',
    borderStrong: '#847ec7',
    text: '#101720',
    textMuted: '#55606f',
    primary: '#5844ed',
    onPrimary: '#ffffff',
    focusRing: '#7966f3',
    income: '#047857',
    expense: '#b91c1c',
    neutral: '#4b5563',
    alert: '#92400e',
  },
  dark: {
    surface: '#03034a',
    surfaceRaised: '#0d1354',
    border: '#1e2563',
    borderStrong: '#6371d6',
    text: '#f2f5f8',
    textMuted: '#a3aebd',
    primary: '#b4a9fe',
    onPrimary: '#03034a',
    focusRing: '#b4a9fe',
    income: '#2ad19b',
    expense: '#ff6b50',
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

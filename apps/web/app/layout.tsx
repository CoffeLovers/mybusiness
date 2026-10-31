import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Asistente Financiero',
  description:
    'Asistente Financiero de MyBusiness: resumen de ingresos, egresos y balance de tu negocio.',
};

/* Se ejecuta antes del primer paint para evitar el destello de tema claro
   (FOUC) cuando la preferencia guardada es oscura. Nunca lanza: si
   localStorage no esta disponible (modo privado, bloqueo de cookies) se
   mantiene el tema claro por defecto. */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (stored === null && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (error) {
    /* Preferencia no disponible: se usa el tema claro. */
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface text-text antialiased">{children}</body>
    </html>
  );
}

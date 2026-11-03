'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';

type NavItem = {
  label: string;
  href: string;
};

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Resumen', href: '/' },
  { label: 'Libro mayor', href: '/libro-mayor' },
  { label: 'Facturas', href: '#' },
  { label: 'Bancos', href: '#' },
  { label: 'Agente', href: '#' },
];

const SEGMENT_LABELS: Record<string, string> = {
  resumen: 'Resumen',
  'libro-mayor': 'Libro mayor',
  movimientos: 'Movimientos',
  facturas: 'Facturas',
  bancos: 'Bancos',
  agente: 'Agente',
};

type Crumb = {
  label: string;
  href: string;
};

export type ShellUser = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

/** Cookie CSRF de doble envío (la única legible por el cliente). */
const CSRF_COOKIE = 'mb_csrf';

/** Lee una cookie no httpOnly; `undefined` si no existe o está vacía. */
function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (entry === undefined) {
    return undefined;
  }

  const rawValue = entry.slice(prefix.length);

  if (rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}

async function logout(): Promise<void> {
  try {
    const csrfToken = readCookie(CSRF_COOKIE);

    await fetch('/api/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfToken === undefined ? {} : { 'x-csrf-token': csrfToken },
    });
  } catch {
    // La sesión local se limpia igualmente al navegar al login.
  }

  window.location.assign('/login');
}

function readableSegment(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

function buildCrumbs(pathname: string): readonly Crumb[] {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const crumbs: Crumb[] = [{ label: 'Resumen', href: '/' }];

  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    crumbs.push({ label: readableSegment(segment), href: accumulated });
  }

  return crumbs;
}

function NavLinks({
  pathname,
  orientation,
}: {
  pathname: string;
  orientation: 'vertical' | 'horizontal';
}) {
  return (
    <ul
      className={
        orientation === 'vertical'
          ? 'flex flex-col gap-1'
          : 'flex items-center gap-1 overflow-x-auto'
      }
    >
      {NAV_ITEMS.map((item) => {
        const isCurrent = item.href === pathname;

        return (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={isCurrent ? 'page' : undefined}
              className={`flex items-center rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                isCurrent
                  ? 'bg-surface text-text'
                  : 'text-text-muted hover:bg-surface hover:text-text'
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children, user }: { children: ReactNode; user?: ShellUser }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface">
      <a
        href="#contenido"
        className="sr-only rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
      >
        Saltar al contenido
      </a>

      <aside className="hidden border-r border-border bg-surface-raised md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:gap-6 md:px-4 md:py-6">
        <p className="px-3 font-mono text-xs tracking-widest text-text-muted uppercase">
          mybusiness
        </p>
        <nav aria-label="Navegación principal">
          <NavLinks pathname={pathname} orientation="vertical" />
        </nav>
      </aside>

      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-10 border-b border-border bg-surface">
          <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
            <nav aria-label="Ruta de navegación" className="min-w-0">
              <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
                {buildCrumbs(pathname).map((crumb, index, all) => {
                  const isLast = index === all.length - 1;

                  return (
                    <li key={crumb.href} className="flex items-center gap-1">
                      {isLast ? (
                        <span aria-current="page" className="font-medium text-text">
                          {crumb.label}
                        </span>
                      ) : (
                        <Link
                          href={crumb.href}
                          className="rounded-sm transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {crumb.label}
                        </Link>
                      )}
                      {isLast ? null : (
                        <span aria-hidden="true" className="px-1">
                          /
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {user === undefined ? null : (
                <p className="hidden text-right text-sm leading-tight sm:block">
                  <span className="block font-medium text-text">{user.firstName}</span>
                  <span className="block text-xs text-text-muted">{user.role}</span>
                </p>
              )}
              <ThemeToggle />
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-text transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          <nav aria-label="Navegación principal móvil" className="px-4 pb-2 md:hidden">
            <NavLinks pathname={pathname} orientation="horizontal" />
          </nav>
        </header>

        <main id="contenido" className="flex-1 px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
